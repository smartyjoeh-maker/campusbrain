create or replace function public.prepare_demo_registration_reset(
  p_student_document uuid,
  p_lecturer_document uuid,
  p_actor uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_ids uuid[];
  v_student_count integer;
  v_lecturer_count integer;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Administrator access required';
  end if;

  perform 1 from public.imported_documents
   where id = p_student_document and category = 'student'
     and filename = 'campusbrain-demo-students.pdf' and status = 'imported'
   for update;
  if not found then raise exception 'The expected demo student import was not found'; end if;
  perform 1 from public.imported_documents
   where id = p_lecturer_document and category = 'lecturer'
     and filename = 'campusbrain-demo-lecturers.pdf' and status = 'imported'
   for update;
  if not found then raise exception 'The expected demo lecturer import was not found'; end if;

  select count(*) into v_student_count from public.student_records where source_document = p_student_document;
  select count(*) into v_lecturer_count from public.lecturer_records where source_document = p_lecturer_document;
  if v_student_count <> 20 or v_lecturer_count <> 20 then
    raise exception 'Demo dataset size changed; reset stopped without deleting records';
  end if;
  if exists (select 1 from public.student_records where source_document = p_student_document
              and (registration_number !~ '^DEMO-STU-[0-9]{4}$'
                   or (claimed_by is not null and not exists (
                     select 1 from public.profiles p where p.id = claimed_by and p.role in ('student','cr')
                   )))) then
    raise exception 'Unexpected student record found in demo batch; reset stopped';
  end if;
  if exists (select 1 from public.lecturer_records where source_document = p_lecturer_document
              and (phone_number !~ '^\+000 100 00 [0-9]{2}$'
                   or full_name !~ '^.*CampusBrain Demo Lecturer [0-9]{2}$'
                   or claimed_by is not null)) then
    raise exception 'Unexpected lecturer record found in demo batch; reset stopped';
  end if;

  select coalesce(array_agg(distinct claimed_by), '{}'::uuid[]) into v_user_ids
    from public.student_records where source_document = p_student_document and claimed_by is not null;
  update public.audit_logs
     set details = details || jsonb_build_object('actor_type', 'deleted_demo_account', 'former_actor_id', actor_id::text),
         actor_id = null
   where actor_id = any(v_user_ids);
  update public.student_records
     set claimed_by = null, authorized_cr = false, cr_authorized_by = null
   where source_document = p_student_document;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_actor, 'demo_registration_reset_prepared', 'imported_documents', p_student_document::text,
            jsonb_build_object('lecturer_document', p_lecturer_document,
                               'students', v_student_count, 'lecturers', v_lecturer_count,
                               'former_student_users', v_user_ids));
  return v_user_ids;
end
$$;

create or replace function public.finish_demo_registration_reset(
  p_student_document uuid,
  p_lecturer_document uuid,
  p_actor uuid,
  p_former_users uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_student_count integer;
  v_lecturer_count integer;
  v_programme_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Administrator access required';
  end if;
  if p_former_users is null or exists (select 1 from public.profiles where id = any(p_former_users)) then
    raise exception 'Former demo accounts must be removed through Supabase Auth before records are deleted';
  end if;
  if exists (select 1 from public.student_records where source_document = p_student_document and claimed_by is not null) then
    raise exception 'Demo student claims were not cleared; reset stopped';
  end if;
  if exists (select 1 from public.lecturer_records where source_document = p_lecturer_document and claimed_by is not null) then
    raise exception 'A lecturer account is linked to this demo batch; reset stopped';
  end if;

  delete from public.student_records where source_document = p_student_document;
  get diagnostics v_student_count = row_count;
  delete from public.lecturer_records where source_document = p_lecturer_document;
  get diagnostics v_lecturer_count = row_count;
  delete from public.imported_documents where id in (p_student_document, p_lecturer_document);

  select id into v_programme_id from public.programmes where name = 'DEMO Computer Science';
  if v_programme_id is not null then
    delete from public.courses c where c.programme_id = v_programme_id and c.code like 'DEMO-CS%'
      and not exists (select 1 from public.student_enrolments e where e.course_id = c.id)
      and not exists (select 1 from public.timetable_entries t where t.course_id = c.id);
    if not exists (select 1 from public.student_records s where s.programme_id = v_programme_id)
       and not exists (select 1 from public.courses c where c.programme_id = v_programme_id) then
      delete from public.programmes where id = v_programme_id;
    end if;
  end if;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_actor, 'demo_registration_reset_completed', 'imported_documents', p_student_document::text,
            jsonb_build_object('students_deleted', v_student_count, 'lecturers_deleted', v_lecturer_count,
                               'former_student_users', p_former_users));
  return jsonb_build_object('students_deleted', v_student_count, 'lecturers_deleted', v_lecturer_count);
end
$$;

revoke all on function public.prepare_demo_registration_reset(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_demo_registration_reset(uuid, uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.prepare_demo_registration_reset(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_demo_registration_reset(uuid, uuid, uuid, uuid[]) to service_role;
