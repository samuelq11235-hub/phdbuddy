-- =====================================================
-- F25.3 — Code merge & split (ATLAS.ti parity)
-- =====================================================
-- merge_codes(target, [sources]) — transfers every quotation_codes row
--   from each source code to the target, then deletes the source rows
--   (which cascades to remove the leftover quotation_codes references).
--
-- split_code(source, [quotation_ids], new_name) — creates a new sibling
--   code with the same parent/color and re-points the given quotation
--   codings from the source to the new code. The original code keeps
--   the quotations NOT in the list.
--
-- Both functions are SECURITY DEFINER so they bypass the per-row
-- ownership checks on quotation_codes (the policies require the user
-- to own each row, but we want admins to merge codes they didn't
-- originally apply). The functions still verify the caller has write
-- permission on the project.

-- -----------------------------------------------------
-- merge_codes
-- -----------------------------------------------------
create or replace function public.merge_codes(
  p_target_code_id uuid,
  p_source_code_ids uuid[]
)
returns table(
  merged_count integer,
  removed_codes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_project uuid;
  v_target_owner uuid;
  v_merged integer := 0;
  v_removed integer := 0;
begin
  if v_caller is null then
    raise exception 'auth.uid() is null';
  end if;

  -- Validate the target code & figure out the project.
  select project_id, user_id into v_target_project, v_target_owner
  from public.codes
  where id = p_target_code_id;

  if v_target_project is null then
    raise exception 'Target code does not exist';
  end if;

  if not public.can_write_project(v_target_project) then
    raise exception 'Forbidden: caller cannot write project';
  end if;

  -- Hard constraint: every source must belong to the SAME project as the
  -- target. Cross-project merges are nonsensical and would leak data.
  if exists (
    select 1
    from public.codes
    where id = any(p_source_code_ids)
      and project_id <> v_target_project
  ) then
    raise exception 'All source codes must belong to the same project as the target';
  end if;

  -- Don't allow merging a code into itself.
  if p_target_code_id = any(p_source_code_ids) then
    raise exception 'Target cannot also be a source';
  end if;

  -- Move every source's quotation_codes onto the target. We use INSERT
  -- ... ON CONFLICT DO NOTHING so a quote already coded with both the
  -- source AND the target collapses to a single row instead of failing.
  with moved as (
    insert into public.quotation_codes (quotation_id, code_id, user_id, created_by_ai, ai_confidence)
    select qc.quotation_id, p_target_code_id, v_target_owner, qc.created_by_ai, qc.ai_confidence
    from public.quotation_codes qc
    where qc.code_id = any(p_source_code_ids)
    on conflict (quotation_id, code_id) do nothing
    returning 1
  )
  select count(*) into v_merged from moved;

  -- Reparent any child codes whose parent is being merged away.
  update public.codes
     set parent_id = p_target_code_id
   where parent_id = any(p_source_code_ids)
     and id <> p_target_code_id;

  -- Re-point quotation_links that reference source codes (none today,
  -- but harmless if we add it later).

  -- Delete the source codes. This cascades and removes their leftover
  -- quotation_codes rows (i.e., the ones that DID conflict on the
  -- ON CONFLICT DO NOTHING above) automatically.
  delete from public.codes where id = any(p_source_code_ids)
  returning 1 into v_removed;

  -- Resync usage_count on the target so the codebook UI doesn't lie.
  update public.codes
     set usage_count = (
       select count(*) from public.quotation_codes where code_id = p_target_code_id
     )
   where id = p_target_code_id;

  return query select v_merged, coalesce(v_removed, 0);
end;
$$;

grant execute on function public.merge_codes(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------
-- split_code
-- -----------------------------------------------------
create or replace function public.split_code(
  p_source_code_id uuid,
  p_quotation_ids uuid[],
  p_new_name text,
  p_new_description text default null
)
returns table(
  new_code_id uuid,
  moved_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_project uuid;
  v_parent uuid;
  v_color text;
  v_new uuid;
  v_moved integer := 0;
begin
  if v_caller is null then
    raise exception 'auth.uid() is null';
  end if;

  if p_quotation_ids is null or array_length(p_quotation_ids, 1) is null then
    raise exception 'Provide at least one quotation_id to move';
  end if;

  select project_id, parent_id, color
    into v_project, v_parent, v_color
  from public.codes
  where id = p_source_code_id;

  if v_project is null then
    raise exception 'Source code does not exist';
  end if;

  if not public.can_write_project(v_project) then
    raise exception 'Forbidden: caller cannot write project';
  end if;

  -- Create the sibling code (same parent + color so the new branch is
  -- visually consistent in the codebook tree).
  insert into public.codes(user_id, project_id, name, description, color, parent_id)
  values (v_caller, v_project, p_new_name, p_new_description, v_color, v_parent)
  returning id into v_new;

  -- Re-point the listed quotations: insert under the new code, then
  -- remove from the source. We never duplicate — if a quote already had
  -- both codes (via merge history) the target row collapses on conflict.
  with target_inserts as (
    insert into public.quotation_codes (quotation_id, code_id, user_id, created_by_ai, ai_confidence)
    select qc.quotation_id, v_new, v_caller, qc.created_by_ai, qc.ai_confidence
    from public.quotation_codes qc
    where qc.code_id = p_source_code_id
      and qc.quotation_id = any(p_quotation_ids)
    on conflict (quotation_id, code_id) do nothing
    returning quotation_id
  )
  select count(*) into v_moved from target_inserts;

  delete from public.quotation_codes
   where code_id = p_source_code_id
     and quotation_id = any(p_quotation_ids);

  -- Resync usage_count on both codes.
  update public.codes
     set usage_count = (
       select count(*) from public.quotation_codes where code_id = p_source_code_id
     )
   where id = p_source_code_id;
  update public.codes
     set usage_count = (
       select count(*) from public.quotation_codes where code_id = v_new
     )
   where id = v_new;

  return query select v_new, v_moved;
end;
$$;

grant execute on function public.split_code(uuid, uuid[], text, text) to authenticated;
