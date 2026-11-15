create extension if not exists pgcrypto;

create type public.account_role as enum ('student', 'cr', 'lecturer', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.account_role not null,
  display_name text not null,
  identity_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  programme_id uuid references public.programmes(id),
  created_at timestamptz not null default now()
);

create table public.student_records (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique,
  last_name text not null,
  full_name text not null,
  year_of_study smallint not null check (year_of_study between 1 and 12),
  programme_id uuid not null references public.programmes(id),
  claimed_by uuid unique references public.profiles(id),
  authorized_cr boolean not null default false,
  cr_authorized_by uuid references public.profiles(id),
  source_document uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lecturer_records (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  last_name text not null,
  full_name text not null,
  claimed_by uuid unique references public.profiles(id),
  source_document uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_enrolments (
  student_id uuid not null references public.student_records(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

create table public.class_representatives (
  student_id uuid primary key references public.student_records(id) on delete cascade,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.imported_documents (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('student', 'lecturer')),
  filename text not null,
  storage_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'previewed', 'imported', 'failed')),
  records_imported integer not null default 0 check (records_imported >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.student_records
  add constraint student_source_document_fk foreign key (source_document) references public.imported_documents(id);
alter table public.lecturer_records
  add constraint lecturer_source_document_fk foreign key (source_document) references public.imported_documents(id);

create table public.registration_attempts (
  id uuid primary key default gen_random_uuid(),
  identity_hash text not null check (identity_hash ~ '^[a-f0-9]{64}$'),
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);
create index registration_attempts_rate_idx on public.registration_attempts(identity_hash, attempted_at desc);
create index registration_attempts_retention_idx on public.registration_attempts(attempted_at);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  subject_type text not null,
  subject_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index student_records_programme_idx on public.student_records(programme_id);
create index student_records_claim_idx on public.student_records(claimed_by);
create index lecturer_records_claim_idx on public.lecturer_records(claimed_by);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

-- This function is also used by authenticated RLS and Storage policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
$$;
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger student_records_set_updated_at
before update on public.student_records
for each row execute function public.set_updated_at();
create trigger lecturer_records_set_updated_at
before update on public.lecturer_records
for each row execute function public.set_updated_at();

-- Create one rate-limit row per retrieval attempt. A separately keyed digest is
-- supplied by the server; the function never receives a registration number.
create or replace function public.begin_registration_attempt(p_identity_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_recent integer;
  v_attempt uuid;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid registration identity digest';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hash, 0));
  select count(*) into v_recent
    from public.registration_attempts
    where identity_hash = p_identity_hash
      and attempted_at > pg_catalog.now() - interval '15 minutes';
  if v_recent >= 8 then
    return null;
  end if;

  insert into public.registration_attempts(identity_hash)
    values (p_identity_hash)
    returning id into v_attempt;
  return v_attempt;
end
$$;
revoke all on function public.begin_registration_attempt(text) from public, anon, authenticated, service_role;
grant execute on function public.begin_registration_attempt(text) to service_role;

create or replace function public.finish_registration_attempt(p_attempt uuid, p_identity_hash text, p_succeeded boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.registration_attempts
     set succeeded = p_succeeded
   where id = p_attempt
     and identity_hash = p_identity_hash
     and attempted_at > pg_catalog.now() - interval '15 minutes';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end
$$;
revoke all on function public.finish_registration_attempt(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.finish_registration_attempt(uuid, text, boolean) to service_role;

-- Invoke from an externally scheduled maintenance task; no pg_cron dependency
-- is assumed by this migration. Retain only the recent window plus 30 days.
create or replace function public.prune_registration_attempts()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.registration_attempts
   where attempted_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;
revoke all on function public.prune_registration_attempts() from public, anon, authenticated, service_role;
grant execute on function public.prune_registration_attempts() to service_role;

create or replace function public.claim_student(p_record uuid, p_user uuid, p_is_cr boolean default false)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
  v_role public.account_role;
  v_authorizer uuid;
begin
  select role into v_role from public.profiles where id = p_user;
  if not found or (p_is_cr and v_role <> 'cr') or (not p_is_cr and v_role <> 'student') then
    return false;
  end if;

  update public.student_records
     set claimed_by = p_user
   where id = p_record
     and claimed_by is null
     and (not p_is_cr or (authorized_cr and cr_authorized_by is not null));
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return false;
  end if;

  if p_is_cr then
    select cr_authorized_by into v_authorizer
      from public.student_records where id = p_record;
    insert into public.class_representatives(student_id, authorized_by)
      values (p_record, v_authorizer);
  end if;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_user, 'account_registered', v_role::text, p_record::text, jsonb_build_object('role', v_role::text));
  return true;
end
$$;
revoke all on function public.claim_student(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.claim_student(uuid, uuid, boolean) to service_role;

create or replace function public.claim_lecturer(p_record uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  if not exists (select 1 from public.profiles where id = p_user and role = 'lecturer') then
    return false;
  end if;
  update public.lecturer_records
     set claimed_by = p_user
   where id = p_record and claimed_by is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return false;
  end if;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_user, 'account_registered', 'lecturer', p_record::text, jsonb_build_object('role', 'lecturer'));
  return true;
end
$$;
revoke all on function public.claim_lecturer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_lecturer(uuid, uuid) to service_role;

create or replace function public.provision_admin_profile(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = p_user;
  if not found or v_email is null or v_email = '' then
    return false;
  end if;

  insert into public.profiles(id, role, display_name, identity_key)
    values (p_user, 'admin', 'Administrator', pg_catalog.lower(v_email))
    on conflict (id) do update
      set role = 'admin',
          display_name = 'Administrator',
          identity_key = excluded.identity_key;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (
      null,
      'administrator_provisioned',
      'profile',
      p_user::text,
      jsonb_build_object(
        'actor_type', 'bootstrap_system',
        'target_user_id', p_user::text
      )
    );
  return true;
end
$$;
revoke all on function public.provision_admin_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provision_admin_profile(uuid) to service_role;

create or replace function public.admin_set_cr_authorization(p_record uuid, p_authorized boolean, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claimed uuid;
  v_role public.account_role;
  v_rows integer;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    return false;
  end if;
  select claimed_by into v_claimed
    from public.student_records where id = p_record for update;
  if not found then
    return false;
  end if;

  update public.student_records
     set authorized_cr = p_authorized,
         cr_authorized_by = case when p_authorized then p_actor else null end
   where id = p_record;

  if v_claimed is not null then
    select role into v_role from public.profiles where id = v_claimed for update;
    if v_role not in ('student', 'cr') then
      raise exception 'Claimed student has an incompatible profile role';
    end if;
    update public.profiles
       set role = case when p_authorized then 'cr'::public.account_role else 'student'::public.account_role end
     where id = v_claimed;

    if p_authorized then
      insert into public.class_representatives(student_id, authorized_by, authorized_at, revoked_at)
        values (p_record, p_actor, pg_catalog.now(), null)
        on conflict (student_id) do update
          set authorized_by = excluded.authorized_by,
              authorized_at = excluded.authorized_at,
              revoked_at = null;
    else
      update public.class_representatives
         set revoked_at = pg_catalog.now()
       where student_id = p_record and revoked_at is null;
    end if;
  end if;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id)
    values (p_actor, case when p_authorized then 'cr_authorized' else 'cr_revoked' end, 'student_record', p_record::text);
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end
$$;
revoke all on function public.admin_set_cr_authorization(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_cr_authorization(uuid, boolean, uuid) to service_role;

create or replace function public.admin_remove_unclaimed_record(p_category text, p_record uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claimed uuid;
  v_rows integer;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    return false;
  end if;
  if p_category = 'student' then
    select claimed_by into v_claimed from public.student_records where id = p_record for update;
    if not found or v_claimed is not null then return false; end if;
    delete from public.student_records where id = p_record and claimed_by is null;
  elsif p_category = 'lecturer' then
    select claimed_by into v_claimed from public.lecturer_records where id = p_record for update;
    if not found or v_claimed is not null then return false; end if;
    delete from public.lecturer_records where id = p_record and claimed_by is null;
  else
    return false;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then return false; end if;

  insert into public.audit_logs(actor_id, action, subject_type, subject_id)
    values (p_actor, 'unclaimed_record_removed', p_category, p_record::text);
  return true;
end
$$;
revoke all on function public.admin_remove_unclaimed_record(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_unclaimed_record(text, uuid, uuid) to service_role;

create or replace function public.commit_registration_import(
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
  v_programme uuid;
  v_year integer;
  v_imported integer := 0;
  v_rejected integer := p_rejected;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Administrator access required';
  end if;
  if p_category is null or p_category not in ('student', 'lecturer')
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 10000
     or p_rejected is null or p_rejected < 0
     or p_storage_path is null
     or p_storage_path not like 'previews/%'
     or p_filename is null then
    raise exception 'Invalid import request';
  end if;

  insert into public.imported_documents(id, category, filename, storage_path, status, uploaded_by)
    values (p_document_id, p_category, p_filename, p_storage_path, 'previewed', p_actor);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if p_category = 'student' then
      if coalesce(v_row->>'registration_number', '') = ''
         or coalesce(v_row->>'last_name', '') = ''
         or coalesce(v_row->>'full_name', '') = ''
         or coalesce(v_row->>'programme', '') = '' then
        raise exception 'Invalid student row';
      end if;
      v_year := (v_row->>'year_of_study')::integer;
      if v_year < 1 or v_year > 12 then raise exception 'Invalid student year'; end if;
      begin
        insert into public.programmes(name)
          values (v_row->>'programme')
          on conflict (name) do update set name = excluded.name
          returning id into v_programme;
        insert into public.student_records(
          registration_number, last_name, full_name, year_of_study, programme_id, source_document
        ) values (
          v_row->>'registration_number', v_row->>'last_name', v_row->>'full_name', v_year, v_programme, p_document_id
        );
        v_imported := v_imported + 1;
      exception when unique_violation then
        v_rejected := v_rejected + 1;
      end;
    else
      if coalesce(v_row->>'last_name', '') = ''
         or coalesce(v_row->>'full_name', '') = ''
         or coalesce(v_row->>'phone_number', '') = '' then
        raise exception 'Invalid lecturer row';
      end if;
      begin
        insert into public.lecturer_records(last_name, full_name, phone_number, source_document)
          values (v_row->>'last_name', v_row->>'full_name', v_row->>'phone_number', p_document_id);
        v_imported := v_imported + 1;
      exception when unique_violation then
        v_rejected := v_rejected + 1;
      end;
    end if;
  end loop;

  update public.imported_documents
     set status = 'imported', records_imported = v_imported,
         records_rejected = v_rejected, completed_at = pg_catalog.now()
   where id = p_document_id;
  insert into public.audit_logs(actor_id, action, subject_type, subject_id, details)
    values (p_actor, 'registration_pdf_import', p_category, p_document_id::text,
            jsonb_build_object('imported', v_imported, 'rejected', v_rejected));
  return jsonb_build_object('document_id', p_document_id, 'imported', v_imported, 'rejected', v_rejected);
end
$$;
revoke all on function public.commit_registration_import(uuid, text, text, text, uuid, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.commit_registration_import(uuid, text, text, text, uuid, jsonb, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.programmes enable row level security;
alter table public.courses enable row level security;
alter table public.student_records enable row level security;
alter table public.lecturer_records enable row level security;
alter table public.student_enrolments enable row level security;
alter table public.class_representatives enable row level security;
alter table public.imported_documents enable row level security;
alter table public.registration_attempts enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read own or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "admin manages profiles" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "verified users read programmes" on public.programmes
  for select to authenticated using ((select auth.uid()) is not null);
create policy "verified users read courses" on public.courses
  for select to authenticated using ((select auth.uid()) is not null);
create policy "students read own record" on public.student_records
  for select to authenticated using (claimed_by = (select auth.uid()) or public.is_admin());
create policy "admin manages student records" on public.student_records
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "lecturers read own record" on public.lecturer_records
  for select to authenticated using (claimed_by = (select auth.uid()) or public.is_admin());
create policy "admin manages lecturer records" on public.lecturer_records
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students read own enrolments" on public.student_enrolments
  for select to authenticated using (
    exists (select 1 from public.student_records s where s.id = student_id and s.claimed_by = (select auth.uid()))
    or public.is_admin()
  );
create policy "admin manages enrolments" on public.student_enrolments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "active CR rows visible to self or admin" on public.class_representatives
  for select to authenticated using (
    public.is_admin()
    or (revoked_at is null and exists (
      select 1 from public.student_records s
      where s.id = student_id and s.claimed_by = (select auth.uid())
    ))
  );
create policy "admin manages CR" on public.class_representatives
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manages documents" on public.imported_documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin reads attempts" on public.registration_attempts
  for select to authenticated using (public.is_admin());
create policy "admin reads audit" on public.audit_logs
  for select to authenticated using (public.is_admin());

-- Browser clients do not access these tables directly. Keep RLS policies as
-- defense in depth if authenticated table access is introduced in the future.
revoke all privileges on table
  public.profiles, public.student_records, public.lecturer_records, public.programmes,
  public.courses, public.student_enrolments, public.class_representatives,
  public.imported_documents, public.registration_attempts, public.audit_logs
from public, anon, authenticated, service_role;

-- Exact server-action and provisioning-script table operations.
grant select, insert on public.profiles to service_role;
grant select on public.student_records, public.lecturer_records, public.programmes to service_role;
grant select on public.imported_documents, public.audit_logs to service_role;

create policy "private registration PDFs administrator only" on storage.objects
  for all to authenticated
  using (bucket_id = 'registration-pdfs' and public.is_admin())
  with check (bucket_id = 'registration-pdfs' and public.is_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('registration-pdfs', 'registration-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
