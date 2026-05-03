-- =====================================================
-- PHDBuddy F4 — Editable Network View
-- =====================================================
-- Persists the Atlas.ti-style code/quotation/memo network as user-curated
-- diagrams: a `networks` container, a per-project library of `relation_types`
-- (causal, mereological, etc.), and `links` connecting any two entities
-- (codes, quotations, memos, documents) inside a network.
--
-- Reference: PHDBUDDY_GAP_ANALYSIS.md, Phase 4.
-- =====================================================

-- -----------------------------------------------------
-- 1. Extend ai_suggestions enum with 'relation'
-- -----------------------------------------------------
-- Idempotent: ALTER TYPE ADD VALUE skips silently when the label already
-- exists, but only on PG14+ when wrapped in a DO/EXCEPTION block.

do $$ begin
  alter type public.ai_suggestion_type add value if not exists 'relation';
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------
-- 2. networks (project-scoped diagrams)
-- -----------------------------------------------------

create table if not exists public.networks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  description text,
  -- Stores per-node positions as { [nodeKey]: { x: number, y: number } }
  -- where nodeKey is "<entity_type>:<entity_id>" so the same code can
  -- live in many networks at distinct coordinates.
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists networks_project_id_idx on public.networks (project_id);
create index if not exists networks_user_id_idx on public.networks (user_id);

alter table public.networks enable row level security;

drop policy if exists "Users manage own networks" on public.networks;
create policy "Users manage own networks"
  on public.networks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists networks_set_updated_at on public.networks;
create trigger networks_set_updated_at
  before update on public.networks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 3. relation_types (project-scoped vocabulary)
-- -----------------------------------------------------

create table if not exists public.relation_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#64748B',
  is_symmetric boolean not null default false,
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists relation_types_unique_name_per_project
  on public.relation_types (project_id, lower(name));
create index if not exists relation_types_project_id_idx
  on public.relation_types (project_id);

alter table public.relation_types enable row level security;

drop policy if exists "Users manage own relation types" on public.relation_types;
create policy "Users manage own relation types"
  on public.relation_types for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------
-- 4. links (entity ↔ entity inside a network)
-- -----------------------------------------------------

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  network_id uuid not null references public.networks (id) on delete cascade,
  source_type text not null check (
    source_type in ('code', 'quotation', 'memo', 'document')
  ),
  source_id uuid not null,
  target_type text not null check (
    target_type in ('code', 'quotation', 'memo', 'document')
  ),
  target_id uuid not null,
  relation_type_id uuid references public.relation_types (id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists links_network_id_idx on public.links (network_id);
create index if not exists links_project_id_idx on public.links (project_id);
create index if not exists links_user_id_idx on public.links (user_id);
-- Helps the source/target lookups when an entity is deleted and we want to
-- prune dangling links from a delete trigger or admin task.
create index if not exists links_source_idx on public.links (source_type, source_id);
create index if not exists links_target_idx on public.links (target_type, target_id);

alter table public.links enable row level security;

drop policy if exists "Users manage own links" on public.links;
create policy "Users manage own links"
  on public.links for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------
-- 5. seed_relation_types(project_id) — idempotent helper
-- -----------------------------------------------------
-- Inserts the canonical Atlas.ti-style relation vocabulary the first time
-- it's called for a project. Safe to call repeatedly: ON CONFLICT skips
-- existing entries by lowercase name.
--
-- We mark these rows is_seed=true so the UI can hide a "delete" affordance
-- on them (the user can rename or recolor, but the vocabulary should
-- stick around). Color choices match common UML/CAQDAS conventions.

create or replace function public.seed_relation_types(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.projects where id = p_project_id;
  if v_user_id is null then
    raise exception 'Project % not found', p_project_id;
  end if;
  if v_user_id <> auth.uid() then
    raise exception 'Not authorized to seed relation types for project %', p_project_id;
  end if;

  insert into public.relation_types
    (user_id, project_id, name, description, color, is_symmetric, is_seed)
  values
    (v_user_id, p_project_id, 'is-cause-of',         'A causa B',                              '#EF4444', false, true),
    (v_user_id, p_project_id, 'is-part-of',          'A es parte/componente de B',             '#0EA5E9', false, true),
    (v_user_id, p_project_id, 'contradicts',         'A contradice o se opone a B',            '#F97316', true,  true),
    (v_user_id, p_project_id, 'is-associated-with',  'A está asociado con B (sin causalidad)', '#7C3AED', true,  true),
    (v_user_id, p_project_id, 'is-property-of',      'A es propiedad/atributo de B',           '#10B981', false, true),
    (v_user_id, p_project_id, 'is-a',                'A es una instancia/subtipo de B',        '#6366F1', false, true)
  on conflict (project_id, lower(name)) do nothing;
end;
$$;

comment on function public.seed_relation_types(uuid) is
  'Seeds the canonical Atlas.ti-style relation vocabulary into a project. Idempotent.';
