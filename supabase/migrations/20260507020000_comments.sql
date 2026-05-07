-- =====================================================
-- F27.2 — Threaded comments
-- =====================================================
-- ATLAS.ti has free-text comments on every entity (codes, quotations,
-- documents, memos). We already store a single comment via the
-- `comment` column on quotations / links. This adds a richer thread:
-- many users can post replies, mention @people, and the conversation
-- is anchored to a single (entity_type, entity_id) pair.

create table if not exists public.entity_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Anchored to one of: code | quotation | memo | document.
  -- We don't FK these because there's no polymorphic FK in pg — instead
  -- we rely on application-level checks + the project_id scope to
  -- bound the blast radius if an entity is deleted (we'll cascade
  -- comments via dedicated triggers later).
  entity_type text not null check (entity_type in ('code', 'quotation', 'memo', 'document')),
  entity_id uuid not null,
  body text not null,
  -- Optional reply parent — flat threads are fine for now (Atlas.ti
  -- itself only goes one level deep), but we keep the column so we can
  -- nest later without a migration.
  parent_comment_id uuid references public.entity_comments(id) on delete cascade,
  -- Optional resolved flag (so reviewers can mark a discussion as
  -- closed without deleting it).
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entity_comments_anchor_idx
  on public.entity_comments (project_id, entity_type, entity_id, created_at);

create index if not exists entity_comments_thread_idx
  on public.entity_comments (parent_comment_id);

alter table public.entity_comments enable row level security;

create policy "members_select_entity_comments"
  on public.entity_comments for select
  using (public.is_project_member(project_id));

-- Anyone with write access can post a comment, but only the author can
-- edit/delete their own. Admins can delete any comment.
create policy "writers_insert_entity_comments"
  on public.entity_comments for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "authors_update_entity_comments"
  on public.entity_comments for update
  using (
    user_id = auth.uid()
    or public.can_admin_project(project_id)
  )
  with check (
    user_id = auth.uid()
    or public.can_admin_project(project_id)
  );

create policy "authors_delete_entity_comments"
  on public.entity_comments for delete
  using (
    user_id = auth.uid()
    or public.can_admin_project(project_id)
  );

create policy "service_role_entity_comments"
  on public.entity_comments for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists entity_comments_set_updated_at on public.entity_comments;
create trigger entity_comments_set_updated_at
  before update on public.entity_comments
  for each row execute function public.set_updated_at();

comment on table public.entity_comments is
  'Threaded discussion attached to any code/quotation/memo/document — for collaborative review and reviewer feedback.';
