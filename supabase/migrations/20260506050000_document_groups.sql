-- =====================================================
-- PHDBuddy F14 — Document groups + structured attributes
-- =====================================================
-- ATLAS.ti lets you group documents (e.g. "Interviews 2024", "Pilot
-- group") and attach typed attributes (gender, year, language) so you
-- can filter and crosstab. We already store free-form jsonb in
-- documents.source_metadata, but the UI has no way to see/filter by
-- those. This migration adds:
--
--   1. document_groups (project-scoped named groups)
--   2. document_group_members (many-to-many)
--   3. document_attribute_schema (project-level vocabulary of typed
--      attributes — text/number/date/choice — so the UI can render the
--      right input and the backend can validate)
--
-- Actual attribute *values* still live in documents.source_metadata
-- jsonb (no migration needed for existing data); the schema just tells
-- the UI which keys are well-known and what their type is.
-- =====================================================

-- -----------------------------------------------------
-- 1. document_groups
-- -----------------------------------------------------

create table if not exists public.document_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#6366F1',
  -- A "smart group" is one whose membership comes from a saved query
  -- against documents (e.g. all docs with attribute year=2024).
  -- For F14 we only ship manual groups; the column is here so the
  -- smart-group F18 can populate it without another migration.
  smart_filter jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_groups_unique_name_per_project
  on public.document_groups (project_id, lower(name));
create index if not exists document_groups_project_idx
  on public.document_groups (project_id);

alter table public.document_groups enable row level security;

create policy "members_select_document_groups"
  on public.document_groups for select
  using (public.is_project_member(project_id));

create policy "writers_insert_document_groups"
  on public.document_groups for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_document_groups"
  on public.document_groups for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_document_groups"
  on public.document_groups for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_document_groups"
  on public.document_groups for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists document_groups_set_updated_at on public.document_groups;
create trigger document_groups_set_updated_at
  before update on public.document_groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 2. document_group_members
-- -----------------------------------------------------

create table if not exists public.document_group_members (
  document_group_id uuid not null references public.document_groups (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (document_group_id, document_id)
);

create index if not exists document_group_members_document_idx
  on public.document_group_members (document_id);

alter table public.document_group_members enable row level security;

-- We don't store project_id here; we derive it from the group. RLS
-- relies on a join — wrapped in a SECURITY DEFINER lookup would be
-- nice, but a simple EXISTS keeps the planner's choices wider open.

create policy "members_select_document_group_members"
  on public.document_group_members for select
  using (
    exists (
      select 1 from public.document_groups dg
      where dg.id = document_group_id
        and public.is_project_member(dg.project_id)
    )
  );

create policy "writers_manage_document_group_members"
  on public.document_group_members for all
  using (
    exists (
      select 1 from public.document_groups dg
      where dg.id = document_group_id
        and public.can_write_project(dg.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.document_groups dg
      where dg.id = document_group_id
        and public.can_write_project(dg.project_id)
    )
  );

create policy "service_role_document_group_members"
  on public.document_group_members for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 3. document_attribute_schema
-- -----------------------------------------------------

create table if not exists public.document_attribute_schema (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stored exactly as it'll be used as the jsonb key in
  -- documents.source_metadata. The UI should normalize whitespace.
  name text not null,
  -- 'text' = free string, 'number' = float, 'date' = ISO date,
  -- 'choice' = one of options[]
  data_type text not null check (data_type in ('text', 'number', 'date', 'choice')),
  options jsonb,
  description text,
  -- Display order in forms / tables.
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_attribute_schema_unique_name
  on public.document_attribute_schema (project_id, lower(name));
create index if not exists document_attribute_schema_project_idx
  on public.document_attribute_schema (project_id);

alter table public.document_attribute_schema enable row level security;

create policy "members_select_document_attribute_schema"
  on public.document_attribute_schema for select
  using (public.is_project_member(project_id));

create policy "writers_manage_document_attribute_schema"
  on public.document_attribute_schema for all
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "service_role_document_attribute_schema"
  on public.document_attribute_schema for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists document_attribute_schema_set_updated_at
  on public.document_attribute_schema;
create trigger document_attribute_schema_set_updated_at
  before update on public.document_attribute_schema
  for each row execute function public.set_updated_at();

comment on table public.document_groups is
  'Named, project-scoped groupings of documents (Atlas.ti "Document Groups").';
comment on table public.document_attribute_schema is
  'Project-level vocabulary of typed document attributes. Values stored in documents.source_metadata jsonb.';
