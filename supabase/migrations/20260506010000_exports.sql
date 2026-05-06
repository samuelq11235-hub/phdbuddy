-- =====================================================
-- PHDBuddy F6 — Export / Import
-- =====================================================
-- 1. Table export_jobs  — tracks async export requests.
-- 2. Storage bucket  'exports'  — private, 50 MiB cap.
--    Files live at  {project_id}/{timestamp}.{ext}.
--    Members of the project can read; service role writes.
-- =====================================================

-- -----------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------

do $$ begin
  create type public.export_format as enum ('csv', 'markdown', 'qdaxml');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.export_job_status as enum ('pending', 'done', 'error');
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------
-- 2. export_jobs table  (MUST come before storage policies)
-- -----------------------------------------------------

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  format public.export_format not null,
  status public.export_job_status not null default 'pending',
  storage_path text,
  signed_url text,
  signed_url_expires_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists export_jobs_project_idx
  on public.export_jobs (project_id, created_at desc);
create index if not exists export_jobs_user_idx
  on public.export_jobs (user_id);

alter table public.export_jobs enable row level security;

drop policy if exists "Members read export jobs" on public.export_jobs;
create policy "Members read export jobs"
  on public.export_jobs for select
  using (public.is_project_member(project_id));

drop policy if exists "Writers insert export jobs" on public.export_jobs;
create policy "Writers insert export jobs"
  on public.export_jobs for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

drop policy if exists "Service role manages export jobs" on public.export_jobs;
create policy "Service role manages export jobs"
  on public.export_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists export_jobs_set_updated_at on public.export_jobs;
create trigger export_jobs_set_updated_at
  before update on public.export_jobs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 3. Storage bucket 'exports'
-- -----------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  52428800,
  array[
    'text/csv',
    'text/plain',
    'text/markdown',
    'text/xml',
    'application/xml',
    'application/zip',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- Members of the owning project may download the export via signed URL.
-- The lookup joins through export_jobs to find the project.
create policy "Project members read exports"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'exports'
    and exists (
      select 1 from public.export_jobs ej
      where ej.storage_path = storage.objects.name
        and public.is_project_member(ej.project_id)
    )
  );

-- Only the edge function (service_role) uploads/deletes export files.
create policy "Service role manages exports bucket"
  on storage.objects for all
  using (bucket_id = 'exports' and auth.role() = 'service_role')
  with check (bucket_id = 'exports' and auth.role() = 'service_role');
