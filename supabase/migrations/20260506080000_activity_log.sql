-- =====================================================
-- PHDBuddy F17 — Activity log (audit trail)
-- =====================================================
-- Tracks who did what and when in a project. Atlas.ti has a similar
-- "Project events" pane that's the basis for any kind of accountability
-- in collaborative coding. We log:
--
--   - quotation create/update/delete
--   - code create/update/delete
--   - quotation_codes attach/detach
--   - memo create/update/delete
--   - project_member add/remove/role change
--
-- Triggers fire AFTER each operation, write a single row, never block
-- the user-facing operation. Storage cost is small (one row per event)
-- but for very large projects (>1M events) you may want to partition
-- by month or rotate. Out of scope for now.
-- =====================================================

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Nullable: triggers may run without an authenticated user (eg from
  -- service-role inserts during import-project). The UI shows "(sistema)"
  -- in that case.
  actor_id uuid references auth.users (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('create', 'update', 'delete', 'attach', 'detach', 'role_change')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_project_idx
  on public.activity_log (project_id, created_at desc);
create index if not exists activity_log_entity_idx
  on public.activity_log (entity_type, entity_id);

alter table public.activity_log enable row level security;

create policy "members_select_activity_log"
  on public.activity_log for select
  using (public.is_project_member(project_id));

create policy "service_role_activity_log"
  on public.activity_log for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- No user INSERT/UPDATE/DELETE policies on purpose: the audit trail is
-- read-only from the API. Triggers below fire as SECURITY DEFINER to
-- bypass RLS when writing rows, otherwise no one would have access.

-- -----------------------------------------------------
-- Helper: log_activity()
-- -----------------------------------------------------
-- Centralised insert helper. Triggers call it with a record-aware
-- payload so we never spread audit fields across many trigger bodies.

create or replace function public.log_activity(
  p_project_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_log
    (project_id, actor_id, entity_type, entity_id, action, metadata)
  values
    (p_project_id, auth.uid(), p_entity_type, p_entity_id, p_action, coalesce(p_metadata, '{}'::jsonb));
exception
  -- Never let a failed audit insert break the user's mutation.
  when others then null;
end;
$$;

-- -----------------------------------------------------
-- Triggers
-- -----------------------------------------------------

-- ----- quotations
create or replace function public._tg_log_quotations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (TG_OP = 'INSERT') then
    perform public.log_activity(
      new.project_id, 'quotation', new.id, 'create',
      jsonb_build_object('document_id', new.document_id, 'len', char_length(coalesce(new.content, '')))
    );
  elsif (TG_OP = 'UPDATE') then
    perform public.log_activity(new.project_id, 'quotation', new.id, 'update', '{}'::jsonb);
  elsif (TG_OP = 'DELETE') then
    perform public.log_activity(old.project_id, 'quotation', old.id, 'delete', '{}'::jsonb);
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_log_quotations on public.quotations;
create trigger tg_log_quotations
  after insert or update or delete on public.quotations
  for each row execute function public._tg_log_quotations();

-- ----- codes
create or replace function public._tg_log_codes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (TG_OP = 'INSERT') then
    perform public.log_activity(new.project_id, 'code', new.id, 'create',
      jsonb_build_object('name', new.name, 'created_by_ai', new.created_by_ai));
  elsif (TG_OP = 'UPDATE') then
    perform public.log_activity(new.project_id, 'code', new.id, 'update',
      jsonb_build_object('name', new.name));
  elsif (TG_OP = 'DELETE') then
    perform public.log_activity(old.project_id, 'code', old.id, 'delete',
      jsonb_build_object('name', old.name));
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_log_codes on public.codes;
create trigger tg_log_codes
  after insert or update or delete on public.codes
  for each row execute function public._tg_log_codes();

-- ----- quotation_codes (attach/detach is the most signal-rich event)
create or replace function public._tg_log_quotation_codes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project_id uuid;
begin
  if (TG_OP = 'INSERT') then
    select project_id into v_project_id from public.quotations where id = new.quotation_id;
    if v_project_id is not null then
      perform public.log_activity(v_project_id, 'coding', new.code_id, 'attach',
        jsonb_build_object('quotation_id', new.quotation_id, 'created_by_ai', new.created_by_ai));
    end if;
  elsif (TG_OP = 'DELETE') then
    select project_id into v_project_id from public.quotations where id = old.quotation_id;
    if v_project_id is not null then
      perform public.log_activity(v_project_id, 'coding', old.code_id, 'detach',
        jsonb_build_object('quotation_id', old.quotation_id));
    end if;
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_log_quotation_codes on public.quotation_codes;
create trigger tg_log_quotation_codes
  after insert or delete on public.quotation_codes
  for each row execute function public._tg_log_quotation_codes();

-- ----- memos
create or replace function public._tg_log_memos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (TG_OP = 'INSERT') then
    perform public.log_activity(new.project_id, 'memo', new.id, 'create',
      jsonb_build_object('title', new.title, 'kind', new.kind));
  elsif (TG_OP = 'UPDATE') then
    perform public.log_activity(new.project_id, 'memo', new.id, 'update',
      jsonb_build_object('title', new.title));
  elsif (TG_OP = 'DELETE') then
    perform public.log_activity(old.project_id, 'memo', old.id, 'delete',
      jsonb_build_object('title', old.title));
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_log_memos on public.memos;
create trigger tg_log_memos
  after insert or update or delete on public.memos
  for each row execute function public._tg_log_memos();

-- ----- project_members (role changes are rare but high-signal)
create or replace function public._tg_log_project_members()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (TG_OP = 'INSERT') then
    perform public.log_activity(new.project_id, 'member', new.user_id, 'attach',
      jsonb_build_object('role', new.role));
  elsif (TG_OP = 'UPDATE') then
    if new.role <> old.role then
      perform public.log_activity(new.project_id, 'member', new.user_id, 'role_change',
        jsonb_build_object('old_role', old.role, 'new_role', new.role));
    end if;
  elsif (TG_OP = 'DELETE') then
    perform public.log_activity(old.project_id, 'member', old.user_id, 'detach',
      jsonb_build_object('role', old.role));
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_log_project_members on public.project_members;
create trigger tg_log_project_members
  after insert or update or delete on public.project_members
  for each row execute function public._tg_log_project_members();

comment on table public.activity_log is
  'Append-only audit trail of project mutations. Members read-only; mutations only via SECURITY DEFINER triggers.';
