-- Move timetable publication to administrators and add CR-created emergency sessions.
-- The application accesses these objects only through its server-side service client.

alter table public.imported_documents drop constraint if exists imported_documents_category_check;
alter table public.imported_documents add constraint imported_documents_category_check
  check (category in ('student', 'lecturer', 'timetable'));

-- Course codes can legitimately recur in different programmes.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_catalog.pg_constraint
     where conrelid = 'public.courses'::regclass and contype = 'u'
       and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (code)'
  loop
    execute format('alter table public.courses drop constraint %I', v_constraint.conname);
  end loop;
end $$;
create unique index if not exists courses_programme_code_unique_idx
  on public.courses(programme_id, code);
create unique index if not exists courses_id_programme_unique_idx
  on public.courses(id, programme_id);

-- A single uploaded department PDF is shared by many programme/year groups.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_catalog.pg_constraint
     where conrelid = 'public.class_timetables'::regclass and contype = 'u'
       and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (storage_path)'
  loop
    execute format('alter table public.class_timetables drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.timetable_entries
  alter column lecturer_record_id drop not null,
  add column if not exists lecturer_name text;
update public.timetable_entries te
   set lecturer_name = lr.full_name
  from public.lecturer_records lr
 where te.lecturer_record_id = lr.id and te.lecturer_name is null;

create table public.emergency_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  year_of_study smallint not null check (year_of_study between 1 and 12),
  course_id uuid not null references public.courses(id),
  session_date date not null,
  day_of_week text not null check (day_of_week in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint emergency_schedule_course_group_fk
    foreign key (course_id, programme_id) references public.courses(id, programme_id)
);
create index emergency_schedule_group_date_idx
  on public.emergency_schedule_entries(programme_id, year_of_study, session_date, start_time);

alter table public.emergency_schedule_entries enable row level security;
revoke all privileges on table public.emergency_schedule_entries from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.emergency_schedule_entries to service_role;

create table public.course_instructors (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  imported_document_id uuid not null references public.imported_documents(id) on delete cascade,
  instructor_name text not null check (pg_catalog.length(pg_catalog.btrim(instructor_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique(imported_document_id, course_id, instructor_name)
);
create index course_instructors_course_idx on public.course_instructors(course_id);
alter table public.course_instructors enable row level security;
revoke all privileges on table public.course_instructors from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_instructors to service_role;

-- Keep direct table reads unavailable to browser sessions; server actions do role checks.
revoke all privileges on table public.class_timetables, public.timetable_entries from public, anon, authenticated;
grant select, insert, update, delete on table public.class_timetables, public.timetable_entries to service_role;
grant select, insert, update, delete on table public.programmes, public.courses, public.student_enrolments,
  public.imported_documents, public.audit_logs to service_role;

drop function if exists public.commit_cr_timetable(uuid, text, text, uuid, uuid, smallint, jsonb);

create or replace function public.commit_admin_timetable_import(
  p_document_id uuid,
  p_filename text,
  p_storage_path text,
  p_actor uuid,
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group jsonb;
  v_row jsonb;
  v_course jsonb;
  v_programme_id uuid;
  v_course_id uuid;
  v_timetable_id uuid;
  v_year smallint;
  v_rows jsonb;
  v_total_entries integer := 0;
  v_group_count integer := 0;
  v_old_count integer := 0;
  v_programme text;
  v_course_name text;
  v_course_code text;
  v_day text;
  v_start time;
  v_end time;
  v_ordinal integer;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor and p.role = 'admin') then
    raise exception 'Administrator access required';
  end if;
  if p_document_id is null or p_filename is null or length(p_filename) not between 1 and 255
     or p_storage_path is null or p_storage_path !~ '^timetables/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
     or p_groups is null or jsonb_typeof(p_groups) <> 'array'
     or jsonb_array_length(p_groups) < 1 or jsonb_array_length(p_groups) > 250 then
    raise exception 'Invalid timetable import request';
  end if;
  if exists (select 1 from public.imported_documents d where d.id = p_document_id) then
    raise exception 'Timetable document id has already been used';
  end if;
  insert into public.imported_documents(id,category,filename,storage_path,status,uploaded_by)
    values(p_document_id,'timetable',p_filename,p_storage_path,'uploaded',p_actor);

  for v_group, v_ordinal in select value, ordinality::integer from jsonb_array_elements(p_groups) with ordinality
  loop
    v_programme := pg_catalog.btrim(coalesce(v_group->>'programme',''));
    v_year := nullif(v_group->>'year','')::smallint;
    v_rows := v_group->'rows';
    if v_programme = '' or pg_catalog.length(v_programme) > 200 or v_year is null or v_year < 1 or v_year > 12
       or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 500
       or jsonb_typeof(v_group->'courses') <> 'array' or jsonb_array_length(v_group->'courses') < 1
       or jsonb_array_length(v_group->'courses') > 500 then
      raise exception 'Invalid timetable group at position %', v_ordinal;
    end if;
    if exists (
      select 1 from public.class_timetables t join public.programmes p on p.id=t.programme_id
       where pg_catalog.lower(p.name)=pg_catalog.lower(v_programme) and t.year_of_study=v_year
       and t.is_published and t.storage_path=p_storage_path
    ) then raise exception 'This PDF group is already published'; end if;

    insert into public.programmes(name) values (v_programme)
      on conflict (name) do update set name=excluded.name returning id into v_programme_id;

    -- Validate the complete course catalog and sessions before replacing a published group.
    for v_course in select value from jsonb_array_elements(v_group->'courses')
    loop
      v_course_code := pg_catalog.btrim(coalesce(v_course->>'code',''));
      v_course_name := pg_catalog.btrim(coalesce(v_course->>'name',''));
      if v_course_code='' or pg_catalog.length(v_course_code)>40 or v_course_name='' or pg_catalog.length(v_course_name)>200
         or pg_catalog.length(coalesce(v_course->>'lecturer_name',''))>200 then
        raise exception 'Invalid course catalog entry in group %', v_ordinal;
      end if;
      if exists (select 1 from public.courses c where c.programme_id=v_programme_id and c.code=v_course_code and c.name<>v_course_name) then
        raise exception 'Course code % conflicts with a different course name in %', v_course_code, v_programme;
      end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_rows)
    loop
      v_course_code := pg_catalog.btrim(coalesce(v_row->>'course_code',''));
      v_course_name := pg_catalog.btrim(coalesce(v_row->>'course_name',''));
      v_day := coalesce(v_row->>'day_of_week','');
      if v_course_code = '' or pg_catalog.length(v_course_code)>40 or v_course_name='' or pg_catalog.length(v_course_name)>200
         or pg_catalog.length(coalesce(v_row->>'lecturer_name',''))>200
         or v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then
        raise exception 'A timetable row in group % is missing a valid course, lecturer or day', v_ordinal;
      end if;
      begin
        v_start := (v_row->>'start_time')::time;
        v_end := (v_row->>'end_time')::time;
      exception when others then raise exception 'Invalid time in timetable group %', v_ordinal;
      end;
      if v_end <= v_start then raise exception 'End time must follow start time in group %', v_ordinal; end if;
      if exists (select 1 from public.courses c where c.programme_id=v_programme_id and c.code=v_course_code and c.name<>v_course_name) then
        raise exception 'Course code % conflicts with a different course name in %', v_course_code, v_programme;
      end if;
    end loop;

    select count(*) into v_old_count from public.class_timetables t
      where t.programme_id=v_programme_id and t.year_of_study=v_year and t.is_published;
    update public.class_timetables set is_published=false
      where programme_id=v_programme_id and year_of_study=v_year and is_published;
    delete from public.student_enrolments se using public.student_records s
      where se.student_id=s.id and s.programme_id=v_programme_id and s.year_of_study=v_year;
    v_timetable_id := gen_random_uuid();
    insert into public.class_timetables(id,programme_id,year_of_study,filename,storage_path,uploaded_by,is_published,published_at)
      values(v_timetable_id,v_programme_id,v_year,p_filename,p_storage_path,p_actor,true,pg_catalog.now());

    for v_course in select value from jsonb_array_elements(v_group->'courses')
    loop
      insert into public.courses(code,name,programme_id) values(
        pg_catalog.btrim(v_course->>'code'),pg_catalog.btrim(v_course->>'name'),v_programme_id)
        on conflict(programme_id,code) do update set name=excluded.name
        where public.courses.name=excluded.name returning id into v_course_id;
      if v_course_id is null then raise exception 'Course catalog identity could not be resolved'; end if;
      insert into public.student_enrolments(student_id,course_id)
        select s.id,v_course_id from public.student_records s
         where s.programme_id=v_programme_id and s.year_of_study=v_year
        on conflict(student_id,course_id) do nothing;
      if pg_catalog.btrim(coalesce(v_course->>'lecturer_name','')) <> '' then
        insert into public.course_instructors(course_id,imported_document_id,instructor_name)
          values(v_course_id,p_document_id,pg_catalog.btrim(v_course->>'lecturer_name'))
          on conflict(imported_document_id,course_id,instructor_name) do nothing;
      end if;
    end loop;

    for v_row in select value from jsonb_array_elements(v_rows)
    loop
      v_course_code := pg_catalog.btrim(v_row->>'course_code');
      v_course_name := pg_catalog.btrim(v_row->>'course_name');
      select id into v_course_id from public.courses
       where programme_id=v_programme_id and code=v_course_code and name=v_course_name;
      if v_course_id is null then raise exception 'Session course is missing from the parsed course catalog'; end if;
      v_start := (v_row->>'start_time')::time;
      v_end := (v_row->>'end_time')::time;
      insert into public.timetable_entries(timetable_id,course_id,lecturer_record_id,lecturer_name,day_of_week,start_time,end_time)
        values(v_timetable_id,v_course_id,null,nullif(pg_catalog.btrim(v_row->>'lecturer_name'),''),v_row->>'day_of_week',v_start,v_end);
    end loop;
    v_total_entries := v_total_entries + jsonb_array_length(v_rows);
    v_group_count := v_group_count + 1;
  end loop;

  update public.imported_documents set status='imported',records_imported=v_total_entries,records_rejected=0,completed_at=pg_catalog.now()
   where id=p_document_id;
  insert into public.audit_logs(actor_id,action,subject_type,subject_id,details)
    values(p_actor,'admin_timetable_imported','imported_document',p_document_id::text,
      jsonb_build_object('filename',p_filename,'groups',v_group_count,'entries',v_total_entries));
  return jsonb_build_object('groups',v_group_count,'entries',v_total_entries);
end
$$;
revoke all on function public.commit_admin_timetable_import(uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commit_admin_timetable_import(uuid,text,text,uuid,jsonb) to service_role;

create or replace function public.commit_cr_emergency_session(
  p_actor uuid, p_course_id uuid, p_session_date date, p_start time, p_end time
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_student public.student_records%rowtype; v_course public.courses%rowtype; v_id uuid;
begin
  if p_actor is null or p_course_id is null or p_session_date is null or p_start is null or p_end is null or p_end<=p_start then
    raise exception 'Invalid emergency session';
  end if;
  select s.* into v_student from public.student_records s join public.profiles p on p.id=s.claimed_by
   where s.claimed_by=p_actor and s.authorized_cr and p.role in ('student','cr');
  if not found then raise exception 'Currently authorized CR access is required'; end if;
  select c.* into v_course from public.courses c
   where c.id=p_course_id and c.programme_id=v_student.programme_id;
  if not found then raise exception 'Course does not belong to the CR study programme'; end if;
  if p_session_date < current_date or p_session_date > current_date + 90 then raise exception 'Session date must be within the next 90 days'; end if;
  insert into public.emergency_schedule_entries(programme_id,year_of_study,course_id,session_date,day_of_week,start_time,end_time,created_by)
   values(v_student.programme_id,v_student.year_of_study,v_course.id,p_session_date,
          case extract(dow from p_session_date)::integer
            when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday'
            when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday' else 'Saturday' end,
          p_start,p_end,p_actor) returning id into v_id;
  insert into public.audit_logs(actor_id,action,subject_type,subject_id,details)
   values(p_actor,'cr_emergency_session_created','emergency_schedule_entry',v_id::text,
     jsonb_build_object('course_id',v_course.id,'session_date',p_session_date,'start_time',p_start,'end_time',p_end));
  return jsonb_build_object('id',v_id);
end
$$;
revoke all on function public.commit_cr_emergency_session(uuid,uuid,date,time,time) from public,anon,authenticated,service_role;
grant execute on function public.commit_cr_emergency_session(uuid,uuid,date,time,time) to service_role;
