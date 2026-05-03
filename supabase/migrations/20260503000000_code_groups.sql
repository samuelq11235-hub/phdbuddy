-- =====================================================
-- PHDBuddy F1 — Code Groups
-- =====================================================
-- Adds Atlas.ti-style "code groups" as a transversal grouping
-- of codes, distinct from the hierarchical `codes.parent_id` tree.
-- A code can belong to multiple groups (m2m).
--
-- Reference: PHDBUDDY_GAP_ANALYSIS.md, Phase 1.
-- =====================================================

-- -----------------------------------------------------
-- 1. code_groups (project-scoped)
-- -----------------------------------------------------

create table if not exists public.code_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#7C3AED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists code_groups_unique_name_per_project
  on public.code_groups (project_id, lower(name));
create index if not exists code_groups_project_id_idx
  on public.code_groups (project_id);
create index if not exists code_groups_user_id_idx
  on public.code_groups (user_id);

alter table public.code_groups enable row level security;

drop policy if exists "Users manage own code groups" on public.code_groups;
create policy "Users manage own code groups"
  on public.code_groups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists code_groups_set_updated_at on public.code_groups;
create trigger code_groups_set_updated_at
  before update on public.code_groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 2. code_group_members (m2m code <-> group)
-- -----------------------------------------------------

create table if not exists public.code_group_members (
  code_id uuid not null references public.codes (id) on delete cascade,
  code_group_id uuid not null references public.code_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code_id, code_group_id)
);

create index if not exists code_group_members_group_id_idx
  on public.code_group_members (code_group_id);
create index if not exists code_group_members_code_id_idx
  on public.code_group_members (code_id);
create index if not exists code_group_members_user_id_idx
  on public.code_group_members (user_id);

alter table public.code_group_members enable row level security;

drop policy if exists "Users manage own group memberships" on public.code_group_members;
create policy "Users manage own group memberships"
  on public.code_group_members for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
