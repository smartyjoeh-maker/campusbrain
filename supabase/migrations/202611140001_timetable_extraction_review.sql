-- Enable admin review of extracted timetable data before publication.
-- Extracted courses and sessions are staged here for administrator verification.
-- Only approved items are committed to public.courses, public.class_timetables,
-- and public.timetable_entries.

create table public.timetable_extraction_review (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.imported_documents(id) on delete cascade,
  source_pdf_filename text not null,
  source_page integer not null,
  item_type text not null check (item_type in ('course', 'session')),
  department text,
  programme text not null,
  year_of_study smallint not null check (year_of_study between 1 and 12),
  semester text,
  course_code text not null,
  course_name text not null,
  lecturer_name text,
  day_of_week text check (day_of_week in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time time,
  end_time time,
  venue text,
  extraction_confidence smallint not null check (extraction_confidence between 0 and 100),
  validation_warnings text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'needs_review')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create index timetable_extraction_review_document_idx
  on public.timetable_extraction_review(document_id);
create index timetable_extraction_review_status_idx
  on public.timetable_extraction_review(status);
create index timetable_extraction_review_group_idx
  on public.timetable_extraction_review(programme, year_of_study, status);

alter table public.timetable_extraction_review enable row level security;
revoke all privileges on table public.timetable_extraction_review from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.timetable_extraction_review to service_role;

-- Allow admins to read all review items; service role manages all access.
create policy "Admins can view all extraction review items"
  on public.timetable_extraction_review
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
