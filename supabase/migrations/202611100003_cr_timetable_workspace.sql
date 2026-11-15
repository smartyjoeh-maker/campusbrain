create table public.class_timetables (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  year_of_study smallint not null check (year_of_study between 1 and 12),
  filename text not null,
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index class_timetables_one_published_per_group_idx
  on public.class_timetables(programme_id, year_of_study)
  where is_published;

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references public.class_timetables(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  lecturer_record_id uuid not null references public.lecturer_records(id),
  day_of_week text not null check (day_of_week in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now(),
  unique (timetable_id, day_of_week, start_time, course_id)
);

create index timetable_entries_schedule_idx
  on public.timetable_entries(timetable_id, day_of_week, start_time);

alter table public.class_timetables enable row level security;
alter table public.timetable_entries enable row level security;

revoke all privileges on table public.class_timetables, public.timetable_entries
  from public, anon, authenticated, service_role;
grant select on public.class_timetables, public.timetable_entries to service_role;

create or replace function public.commit_cr_timetable(
  p_timetable_id uuid,
  p_filename text,
  p_storage_path text,
  p_actor uuid,
  p_programme_id uuid,
  p_year smallint,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row jsonb;
  v_course_id uuid;
  v_lecturer_ids uuid[];
  v_lecturer_id uuid;
  v_start time;
  v_end time;
  v_old_timetable_ids uuid[];
  v_student_count integer := 0;
begin
  if p_timetable_id is null or p_actor is null or p_programme_id is null
     or p_year is null or p_year < 1 or p_year > 12
     or p_filename is null or length(p_filename) > 255
     or p_storage_path is null or p_storage_path !~ '^previews/timetables/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Invalid timetable import request';
  end if;

  if not exists (
    select 1
      from public.profiles p
      join public.student_records s on s.claimed_by = p.id
     where p.id = p_actor and p.role in ('student','cr')
       and s.authorized_cr and s.programme_id = p_programme_id
       and s.year_of_study = p_year
  ) then
    raise exception 'An active administrator-authorized CR for this programme and year is required';
  end if;

  -- Resolve every course and lecturer against existing verified records before publishing.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row->>'course_code','') = ''
       or coalesce(v_row->>'course_name','') = ''
       or coalesce(v_row->>'lecturer_name','') = ''
       or coalesce(v_row->>'day_of_week','') not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then
      raise exception 'A timetable row is missing a required field';
    end if;
    begin
      v_start := (v_row->>'start_time')::time;
      v_end := (v_row->>'end_time')::time;
    exception when others then
      raise exception 'Invalid timetable time';
    end;
    if v_end <= v_start then raise exception 'Timetable end time must follow start time'; end if;

    v_course_id := null;
    select c.id into v_course_id
      from public.courses c
     where c.code = v_row->>'course_code'
       and c.name = v_row->>'course_name'
       and c.programme_id = p_programme_id;
    if v_course_id is null then raise exception 'Course code, name, or programme does not match verified course records'; end if;

    select array_agg(distinct l.id) into v_lecturer_ids
      from public.lecturer_records l
      join public.lecturer_course_assignments a on a.lecturer_record_id = l.id
     where l.full_name = v_row->>'lecturer_name'
       and a.course_id = v_course_id;
    if coalesce(cardinality(v_lecturer_ids), 0) <> 1 then
      raise exception 'Lecturer must uniquely match an existing assignment for this course';
    end if;
  end loop;

  select array_agg(id) into v_old_timetable_ids
    from public.class_timetables
   where programme_id = p_programme_id and year_of_study = p_year and is_published;
  update public.class_timetables
     set is_published = false
   where programme_id = p_programme_id and year_of_study = p_year and is_published;

  insert into public.class_timetables(
    id, programme_id, year_of_study, filename, storage_path, uploaded_by, is_published, published_at
  ) values (
    p_timetable_id, p_programme_id, p_year, p_filename, p_storage_path, p_actor, true, pg_catalog.now()
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select c.id into v_course_id
      from public.courses c
     where c.code = v_row->>'course_code'
       and c.name = v_row->>'course_name'
       and c.programme_id = p_programme_id;
    select array_agg(distinct l.id) into v_lecturer_ids
      from public.lecturer_records l
      join public.lecturer_course_assignments a on a.lecturer_record_id = l.id
     where l.full_name = v_row->>'lecturer_name'
       and a.course_id = v_course_id;
    v_lecturer_id := v_lecturer_ids[1];
    v_start := (v_row->>'start_time')::time;
    v_end := (v_row->>'end_time')::time;

    insert into public.timetable_entries(
      timetable_id, course_id, lecturer_record_id, day_of_week, start_time, end_time
    ) values (
      p_timetable_id, v_course_id, v_lecturer_id, v_row->>'day_of_week', v_start, v_end
    );
    insert into public.student_enrolments(student_id, course_id)
      select s.id, v_course_id
        from public.student_records s
       where s.programme_id = p_programme_id and s.year_of_study = p_year
      on conflict (student_id, course_id) do nothing;
  end loop;

  select count(*) into v_student_count from public.student_records
   where programme_id = p_programme_id and year_of_study = p_year;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_actor, 'cr_timetable_published', 'class_timetable', p_timetable_id::text,
      jsonb_build_object('programme_id', p_programme_id, 'year_of_study', p_year,
                         'entries', jsonb_array_length(p_rows), 'students_in_group', v_student_count,
                         'replaced_timetables', coalesce(array_length(v_old_timetable_ids, 1), 0)));

  return jsonb_build_object('timetable_id', p_timetable_id, 'entries', jsonb_array_length(p_rows),
                            'students_in_group', v_student_count);
end
$$;

revoke all on function public.commit_cr_timetable(uuid, text, text, uuid, uuid, smallint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_cr_timetable(uuid, text, text, uuid, uuid, smallint, jsonb)
  to service_role;
