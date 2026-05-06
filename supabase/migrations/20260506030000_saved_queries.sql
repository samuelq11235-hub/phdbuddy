-- Migration: F11 saved queries
-- Boolean queries over codes/documents/sentiment, persisted as JSON AST.

set search_path = public, extensions;

create table if not exists public.saved_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  description text,
  -- AST shape (validated client-side and server-side):
  --   { op: 'and'|'or'|'not'|'code'|'document'|'sentiment'|'in_document', ... }
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_queries_project_idx
  on public.saved_queries (project_id);

create trigger saved_queries_set_updated_at
  before update on public.saved_queries
  for each row execute function public.set_updated_at();

alter table public.saved_queries enable row level security;

drop policy if exists "Project members read saved_queries" on public.saved_queries;
create policy "Project members read saved_queries"
  on public.saved_queries for select
  to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "Project writers manage saved_queries" on public.saved_queries;
create policy "Project writers manage saved_queries"
  on public.saved_queries for all
  to authenticated
  using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));
