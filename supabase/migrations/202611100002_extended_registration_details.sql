-- Optional verified student details and lecturer course assignments.
-- This is additive so it can follow the already-applied initial migration.

alter table public.student_records
  add column if not exists gender text,
  add column if not exists phone_number text,
  add column if not exists qualification_level text;

alter table public.student_records
  add constraint student_records_gender_check
    check (gender is null or gender in ('Female', 'Male', 'Other', 'Prefer not to say')),
  add constraint student_records_qualification_level_check
    check (qualification_level is null or qualification_level ~ '^UQF [0-9]{1,2}$');

create table public.lecturer_course_assignments (
  lecturer_record_id uuid not null references public.lecturer_records(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lecturer_record_id, course_id)
);

alter table public.lecturer_course_assignments enable row level security;
revoke all privileges on table public.lecturer_course_assignments from public, anon, authenticated, service_role;
grant select on public.lecturer_course_assignments, public.courses, public.student_enrolments to service_role;

create or replace function public.commit_enriched_registration_import(
  p_document_id uuid,
  p_category text,
  p_filename text,
  p_storage_path text,
  p_actor uuid,
  p_rows jsonb,
  p_rejected integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row jsonb;
  v_course jsonb;
  v_result jsonb;
  v_student_id uuid;
  v_lecturer_id uuid;
  v_programme_id uuid;
  v_course_id uuid;
  v_existing_name text;
  v_course_programme uuid;
begin
  if not exists (
    select 1 from public.profiles p where p.id = p_actor and p.role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Invalid import rows';
  end if;

  -- Validate extended fields before the existing transactional import routine.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if p_category = 'student' then
      if v_row ? 'gender' and v_row->>'gender' not in ('Female', 'Male', 'Other', 'Prefer not to say') then
        raise exception 'Invalid student gender';
      end if;
      if v_row ? 'qualification_level' and v_row->>'qualification_level' !~ '^UQF [0-9]{1,2}$' then
        raise exception 'Invalid qualification level';
      end if;
      if v_row ? 'phone_number' and v_row->>'phone_number' !~ '^[+0-9][0-9 ()-]{5,24}$' then
        raise exception 'Invalid student phone number';
      end if;
      if coalesce((v_row->>'cr_candidate')::boolean, false) is true
         and coalesce(v_row->>'registration_number', '') = '' then
        raise exception 'Invalid CR authorization candidate';
      end if;
    elsif p_category = 'lecturer' then
      if v_row ? 'courses' and (jsonb_typeof(v_row->'courses') <> 'array' or jsonb_array_length(v_row->'courses') > 20) then
        raise exception 'Invalid lecturer course list';
      end if;
      if jsonb_typeof(v_row->'courses') = 'array' then
        for v_course in select value from jsonb_array_elements(v_row->'courses')
        loop
          if coalesce(v_course->>'code', '') = ''
             or coalesce(v_course->>'name', '') = ''
             or coalesce(v_course->>'programme', '') = '' then
            raise exception 'Incomplete lecturer course assignment';
          end if;
        end loop;
      end if;
    else
      raise exception 'Invalid import category';
    end if;
  end loop;

  v_result := public.commit_registration_import(
    p_document_id, p_category, p_filename, p_storage_path, p_actor, p_rows, p_rejected
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if p_category = 'student' then
      update public.student_records
         set gender = nullif(v_row->>'gender', ''),
             phone_number = nullif(v_row->>'phone_number', ''),
             qualification_level = nullif(v_row->>'qualification_level', '')
       where registration_number = v_row->>'registration_number'
         and source_document = p_document_id
       returning id into v_student_id;

      if coalesce((v_row->>'cr_candidate')::boolean, false) is true and v_student_id is not null then
        update public.student_records
           set authorized_cr = true,
               cr_authorized_by = p_actor
         where id = v_student_id;
        insert into public.class_representatives(student_id, authorized_by, authorized_at, revoked_at)
          values (v_student_id, p_actor, pg_catalog.now(), null)
          on conflict (student_id) do update
            set authorized_by = excluded.authorized_by,
                authorized_at = excluded.authorized_at,
                revoked_at = null;
        insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
          values (p_actor, 'cr_authorized_during_registration_import', 'student_record', v_student_id::text,
                  jsonb_build_object('source_document', p_document_id));
      end if;
    else
      select id into v_lecturer_id
        from public.lecturer_records
       where phone_number = v_row->>'phone_number'
         and source_document = p_document_id;
      if v_lecturer_id is not null and jsonb_typeof(v_row->'courses') = 'array' then
        for v_course in select value from jsonb_array_elements(v_row->'courses')
        loop
          insert into public.programmes(name)
            values (v_course->>'programme')
            on conflict (name) do update set name = excluded.name
            returning id into v_programme_id;

          select id, name, programme_id into v_course_id, v_existing_name, v_course_programme
            from public.courses where code = v_course->>'code';
          if v_course_id is null then
            insert into public.courses(code, name, programme_id)
              values (v_course->>'code', v_course->>'name', v_programme_id)
              returning id into v_course_id;
          elsif v_existing_name <> v_course->>'name' then
            raise exception 'Course code % conflicts with an existing course name', v_course->>'code';
          end if;

          insert into public.lecturer_course_assignments(lecturer_record_id, course_id)
            values (v_lecturer_id, v_course_id)
            on conflict do nothing;
        end loop;
      end if;
    end if;
  end loop;

  return v_result;
end
$$;

revoke all on function public.commit_enriched_registration_import(uuid, text, text, text, uuid, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_enriched_registration_import(uuid, text, text, text, uuid, jsonb, integer)
  to service_role;
