-- =====================================================
-- PHDBuddy F5 — Multi-user collaboration
-- =====================================================
-- Pivots the project from single-owner ("auth.uid() = user_id") to
-- shared-project membership with role-based access control.
--
-- New surface:
--   • enum   project_role             ('owner','admin','coder','viewer')
--   • table  project_members          (project_id, user_id, role)
--   • table  project_invitations      (token, email, role, expiry)
--   • helpers is_project_member(p),
--             project_role_for(p),
--             can_write_project(p),
--             can_admin_project(p),
--             is_project_owner(p)
--
-- All tables that store project-scoped content drop their
-- "auth.uid() = user_id" policies and adopt:
--   SELECT  → any project member
--   INSERT  → writer (owner/admin/coder) AND user_id = auth.uid()
--   UPDATE  → writer; row-owner OR admin/owner of project
--   DELETE  → writer; row-owner OR admin/owner of project
--
-- The user_id columns are KEPT as immutable attribution. Only the RLS
-- changes — no data is destroyed.
--
-- Reference: PHDBUDDY_GAP_ANALYSIS.md, Phase 5.
-- =====================================================

-- -----------------------------------------------------
-- 1. project_role enum
-- -----------------------------------------------------

do $$ begin
  create type public.project_role as enum ('owner', 'admin', 'coder', 'viewer');
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------
-- 2. project_members table
-- -----------------------------------------------------

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.project_role not null default 'coder',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists project_members_project_id_idx
  on public.project_members (project_id);
create index if not exists project_members_user_id_idx
  on public.project_members (user_id);

drop trigger if exists project_members_set_updated_at on public.project_members;
create trigger project_members_set_updated_at
  before update on public.project_members
  for each row execute function public.set_updated_at();

-- Backfill: every existing project becomes owned by its creator.
insert into public.project_members (project_id, user_id, role)
select p.id, p.user_id, 'owner'::public.project_role
from public.projects p
on conflict (project_id, user_id) do nothing;

-- Trigger: any new project automatically gets an owner row.
create or replace function public.add_project_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.user_id, 'owner')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists projects_add_owner on public.projects;
create trigger projects_add_owner
  after insert on public.projects
  for each row execute function public.add_project_owner();

-- -----------------------------------------------------
-- 3. project_invitations table
-- -----------------------------------------------------

create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null,
  role public.project_role not null default 'coder',
  token text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- Cannot invite to the owner role — owners are minted by project creation
  -- or via explicit transfer (not in F5).
  check (role <> 'owner')
);

create index if not exists project_invitations_project_idx
  on public.project_invitations (project_id);
create index if not exists project_invitations_email_idx
  on public.project_invitations (lower(email));
create index if not exists project_invitations_token_idx
  on public.project_invitations (token);

-- -----------------------------------------------------
-- 4. Membership helper functions (SECURITY DEFINER)
-- -----------------------------------------------------
-- These bypass RLS on `project_members` so we can call them from RLS
-- policies on every other table without recursion. They read the
-- current `auth.uid()` and answer questions about THAT user only —
-- they cannot leak membership info about other users.

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.project_role_for(p_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.project_members
  where project_id = p_project_id
    and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_write_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'coder')
  );
$$;

create or replace function public.can_admin_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

comment on function public.is_project_member(uuid) is
  'True when the calling user is a member of the project, regardless of role.';
comment on function public.can_write_project(uuid) is
  'True when the calling user has owner|admin|coder role — can create rows.';
comment on function public.can_admin_project(uuid) is
  'True when the calling user has owner|admin role — can edit anyone''s rows.';

-- -----------------------------------------------------
-- 5. RLS on project_members itself
-- -----------------------------------------------------

alter table public.project_members enable row level security;

drop policy if exists "Members read membership" on public.project_members;
drop policy if exists "Owners manage membership" on public.project_members;
drop policy if exists "Service role manages membership" on public.project_members;

-- Any project member can see who else is on the project.
create policy "Members read membership"
  on public.project_members for select
  using (public.is_project_member(project_id));

-- Only owners can add/change/remove members. Admins do NOT manage roles
-- to avoid privilege-escalation paths (admin→owner).
create policy "Owners manage membership"
  on public.project_members for all
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- Service role (edge functions) can do anything — needed for
-- accept-invitation (the new member is not yet authorized).
create policy "Service role manages membership"
  on public.project_members for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Prevent removing the last owner of a project. Without this, an owner
-- could downgrade themselves and orphan the project.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
as $$
declare
  v_remaining int;
  v_project_id uuid;
begin
  if (tg_op = 'DELETE') then
    if old.role <> 'owner' then return old; end if;
    v_project_id := old.project_id;
  elsif (tg_op = 'UPDATE') then
    if old.role <> 'owner' or new.role = 'owner' then return new; end if;
    v_project_id := old.project_id;
  end if;

  select count(*) into v_remaining
  from public.project_members
  where project_id = v_project_id and role = 'owner'
    and (tg_op <> 'DELETE' or id <> old.id)
    and (tg_op <> 'UPDATE' or id <> old.id);

  if v_remaining = 0 then
    raise exception 'Cannot remove the last owner of project %', v_project_id;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists project_members_guard_last_owner on public.project_members;
create trigger project_members_guard_last_owner
  before update or delete on public.project_members
  for each row execute function public.guard_last_owner();

-- -----------------------------------------------------
-- 6. RLS on project_invitations
-- -----------------------------------------------------

alter table public.project_invitations enable row level security;

drop policy if exists "Admins manage invitations" on public.project_invitations;
drop policy if exists "Service role manages invitations" on public.project_invitations;

create policy "Admins manage invitations"
  on public.project_invitations for all
  using (public.can_admin_project(project_id))
  with check (public.can_admin_project(project_id));

create policy "Service role manages invitations"
  on public.project_invitations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 7. Rewrite RLS on every project-scoped table
-- -----------------------------------------------------
-- Pattern (with X as the table):
--   members_select_X    SELECT  is_project_member(project_id)
--   writers_insert_X    INSERT  can_write_project AND user_id = auth.uid()
--   writers_update_X    UPDATE  can_write_project AND (own row OR can_admin)
--   writers_delete_X    DELETE  can_write_project AND (own row OR can_admin)
--   service_role_X      ALL     auth.role() = 'service_role'

-- ----- projects --------------------------------------

drop policy if exists "Users manage own projects" on public.projects;

create policy "Members read project"
  on public.projects for select
  using (public.is_project_member(id));

create policy "Authenticated insert project"
  on public.projects for insert
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Admins update project"
  on public.projects for update
  using (public.can_admin_project(id))
  with check (public.can_admin_project(id));

create policy "Owners delete project"
  on public.projects for delete
  using (public.is_project_owner(id));

create policy "Service role manages projects"
  on public.projects for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- documents -------------------------------------

drop policy if exists "Users manage own documents" on public.documents;

create policy "members_select_documents"
  on public.documents for select
  using (public.is_project_member(project_id));

create policy "writers_insert_documents"
  on public.documents for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_documents"
  on public.documents for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_documents"
  on public.documents for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_documents"
  on public.documents for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- document_chunks (no user_id; service-role write) --

drop policy if exists "Users view chunks of own docs" on public.document_chunks;
drop policy if exists "Service role manages chunks" on public.document_chunks;

create policy "members_select_chunks"
  on public.document_chunks for select
  using (public.is_project_member(project_id));

create policy "service_role_chunks"
  on public.document_chunks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- codes -----------------------------------------

drop policy if exists "Users manage own codes" on public.codes;

create policy "members_select_codes"
  on public.codes for select
  using (public.is_project_member(project_id));

create policy "writers_insert_codes"
  on public.codes for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_codes"
  on public.codes for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_codes"
  on public.codes for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_codes"
  on public.codes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- quotations ------------------------------------

drop policy if exists "Users manage own quotations" on public.quotations;

create policy "members_select_quotations"
  on public.quotations for select
  using (public.is_project_member(project_id));

create policy "writers_insert_quotations"
  on public.quotations for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_quotations"
  on public.quotations for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_quotations"
  on public.quotations for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_quotations"
  on public.quotations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- quotation_codes (no project_id column; subquery via quotations) -----

drop policy if exists "Users manage own coding" on public.quotation_codes;

create policy "members_select_qc"
  on public.quotation_codes for select
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_codes.quotation_id
        and public.is_project_member(q.project_id)
    )
  );

create policy "writers_insert_qc"
  on public.quotation_codes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.quotations q
      where q.id = quotation_codes.quotation_id
        and public.can_write_project(q.project_id)
    )
  );

create policy "writers_update_qc"
  on public.quotation_codes for update
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_codes.quotation_id
        and public.can_write_project(q.project_id)
        and (quotation_codes.user_id = auth.uid() or public.can_admin_project(q.project_id))
    )
  )
  with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_codes.quotation_id
        and public.can_write_project(q.project_id)
        and (quotation_codes.user_id = auth.uid() or public.can_admin_project(q.project_id))
    )
  );

create policy "writers_delete_qc"
  on public.quotation_codes for delete
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_codes.quotation_id
        and public.can_write_project(q.project_id)
        and (quotation_codes.user_id = auth.uid() or public.can_admin_project(q.project_id))
    )
  );

create policy "service_role_qc"
  on public.quotation_codes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- memos -----------------------------------------

drop policy if exists "Users manage own memos" on public.memos;

create policy "members_select_memos"
  on public.memos for select
  using (public.is_project_member(project_id));

create policy "writers_insert_memos"
  on public.memos for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_memos"
  on public.memos for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_memos"
  on public.memos for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_memos"
  on public.memos for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- ai_suggestions --------------------------------

drop policy if exists "Users manage own suggestions" on public.ai_suggestions;
drop policy if exists "Service role manages suggestions" on public.ai_suggestions;

create policy "members_select_suggestions"
  on public.ai_suggestions for select
  using (public.is_project_member(project_id));

create policy "writers_insert_suggestions"
  on public.ai_suggestions for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_suggestions"
  on public.ai_suggestions for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_suggestions"
  on public.ai_suggestions for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_suggestions"
  on public.ai_suggestions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- chat_sessions (kept private per-user) ---------
-- Conversations are personal scratchpads — we don't share them between
-- members. We DO require membership at insert-time so kicked members
-- can't keep spawning sessions on the project they no longer have.

drop policy if exists "Users manage own sessions" on public.chat_sessions;

create policy "Users select own sessions"
  on public.chat_sessions for select
  using (auth.uid() = user_id);

create policy "Members insert own sessions"
  on public.chat_sessions for insert
  with check (
    auth.uid() = user_id
    and public.is_project_member(project_id)
  );

create policy "Users update own sessions"
  on public.chat_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own sessions"
  on public.chat_sessions for delete
  using (auth.uid() = user_id);

create policy "Service role manages sessions"
  on public.chat_sessions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- chat_messages (mirrors chat_sessions) ---------

drop policy if exists "Users view own session messages" on public.chat_messages;
drop policy if exists "Users insert own session messages" on public.chat_messages;

create policy "Users view own session messages"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

create policy "Users insert own session messages"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

-- ----- code_groups -----------------------------------

drop policy if exists "Users manage own code groups" on public.code_groups;

create policy "members_select_code_groups"
  on public.code_groups for select
  using (public.is_project_member(project_id));

create policy "writers_insert_code_groups"
  on public.code_groups for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_code_groups"
  on public.code_groups for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_code_groups"
  on public.code_groups for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_code_groups"
  on public.code_groups for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- code_group_members (no project_id; subquery) --

drop policy if exists "Users manage own group memberships" on public.code_group_members;

create policy "members_select_cgm"
  on public.code_group_members for select
  using (
    exists (
      select 1 from public.code_groups g
      where g.id = code_group_members.code_group_id
        and public.is_project_member(g.project_id)
    )
  );

create policy "writers_insert_cgm"
  on public.code_group_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.code_groups g
      where g.id = code_group_members.code_group_id
        and public.can_write_project(g.project_id)
    )
  );

create policy "writers_delete_cgm"
  on public.code_group_members for delete
  using (
    exists (
      select 1 from public.code_groups g
      where g.id = code_group_members.code_group_id
        and public.can_write_project(g.project_id)
        and (code_group_members.user_id = auth.uid() or public.can_admin_project(g.project_id))
    )
  );

create policy "service_role_cgm"
  on public.code_group_members for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- quotation_sentiment ---------------------------

drop policy if exists "Users manage own sentiment" on public.quotation_sentiment;
drop policy if exists "Service role manages sentiment" on public.quotation_sentiment;

create policy "members_select_sentiment"
  on public.quotation_sentiment for select
  using (public.is_project_member(project_id));

create policy "writers_insert_sentiment"
  on public.quotation_sentiment for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_sentiment"
  on public.quotation_sentiment for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_sentiment"
  on public.quotation_sentiment for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_sentiment"
  on public.quotation_sentiment for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- networks --------------------------------------

drop policy if exists "Users manage own networks" on public.networks;

create policy "members_select_networks"
  on public.networks for select
  using (public.is_project_member(project_id));

create policy "writers_insert_networks"
  on public.networks for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_networks"
  on public.networks for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_networks"
  on public.networks for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_networks"
  on public.networks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- relation_types --------------------------------

drop policy if exists "Users manage own relation types" on public.relation_types;

create policy "members_select_relation_types"
  on public.relation_types for select
  using (public.is_project_member(project_id));

create policy "writers_insert_relation_types"
  on public.relation_types for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_relation_types"
  on public.relation_types for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_relation_types"
  on public.relation_types for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_relation_types"
  on public.relation_types for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----- links -----------------------------------------

drop policy if exists "Users manage own links" on public.links;

create policy "members_select_links"
  on public.links for select
  using (public.is_project_member(project_id));

create policy "writers_insert_links"
  on public.links for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_links"
  on public.links for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_links"
  on public.links for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_links"
  on public.links for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 8. Storage bucket — extend SELECT to project members
-- -----------------------------------------------------
-- The existing user-folder INSERT/UPDATE/DELETE policies stay so files
-- only land in the uploader's folder. SELECT broadens to "any member of
-- the document's project" so collaborators can preview originals.

drop policy if exists "Users can read own files" on storage.objects;

create policy "Project members read documents bucket"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and public.is_project_member(d.project_id)
    )
  );

-- Index helps the lookup above run cheaply per file fetch.
create index if not exists documents_storage_path_idx
  on public.documents (storage_path)
  where storage_path is not null;

-- -----------------------------------------------------
-- 9. Update seed_relation_types to use membership
-- -----------------------------------------------------
-- Previously checked v_user_id = auth.uid() (single-owner model). Now
-- any writer of the project can seed the relation vocabulary.

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
  if not public.can_write_project(p_project_id) then
    raise exception 'Not authorized to seed relation types for project %', p_project_id;
  end if;

  -- We attribute the seeded rows to the current user so RLS-update
  -- semantics (you can rename/recolor your own seeds) keep working.
  insert into public.relation_types
    (user_id, project_id, name, description, color, is_symmetric, is_seed)
  values
    (auth.uid(), p_project_id, 'is-cause-of',         'A causa B',                              '#EF4444', false, true),
    (auth.uid(), p_project_id, 'is-part-of',          'A es parte/componente de B',             '#0EA5E9', false, true),
    (auth.uid(), p_project_id, 'contradicts',         'A contradice o se opone a B',            '#F97316', true,  true),
    (auth.uid(), p_project_id, 'is-associated-with',  'A está asociado con B (sin causalidad)', '#7C3AED', true,  true),
    (auth.uid(), p_project_id, 'is-property-of',      'A es propiedad/atributo de B',           '#10B981', false, true),
    (auth.uid(), p_project_id, 'is-a',                'A es una instancia/subtipo de B',        '#6366F1', false, true)
  on conflict (project_id, lower(name)) do nothing;
end;
$$;

-- -----------------------------------------------------
-- 10. Convenience RPC: my_projects_with_role()
-- -----------------------------------------------------
-- The /app/projects list now needs to know the caller's role on each
-- project (so the UI can hide the "Delete" button for non-owners,
-- etc.). Implemented as an RPC instead of a join from the client to
-- keep RLS semantics explicit and side-step PostgREST embedding quirks.

create or replace function public.my_projects_with_role()
returns table (
  id uuid,
  name text,
  description text,
  research_question text,
  methodology text,
  color text,
  document_count int,
  code_count int,
  quotation_count int,
  memo_count int,
  created_at timestamptz,
  updated_at timestamptz,
  role public.project_role
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id, p.name, p.description, p.research_question, p.methodology,
    p.color, p.document_count, p.code_count, p.quotation_count,
    p.memo_count, p.created_at, p.updated_at,
    pm.role
  from public.projects p
  join public.project_members pm
    on pm.project_id = p.id and pm.user_id = auth.uid()
  order by p.updated_at desc;
$$;

comment on function public.my_projects_with_role() is
  'Lists projects where the caller is a member, annotated with their role.';
