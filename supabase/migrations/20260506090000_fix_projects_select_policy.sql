-- =====================================================
-- Fix: project creation 403 (INSERT ... RETURNING)
-- =====================================================
-- The F5 multi-user migration replaced the projects SELECT policy
-- with one that calls is_project_member(id). That helper is
-- STABLE SECURITY DEFINER and uses the calling statement's MVCC
-- snapshot — so it does NOT see the project_members row inserted
-- by the AFTER trigger `projects_add_owner` during the same
-- INSERT ... RETURNING statement. Result: PostgREST sends
-- `INSERT INTO projects (...) RETURNING *` and the RETURNING
-- pass over the RLS SELECT policy on the brand-new row evaluates
-- is_project_member(id) -> false, so the whole INSERT is rolled
-- back with the misleading error
--
--    new row violates row-level security policy for table "projects"
--
-- Fix: the creator (projects.user_id = auth.uid()) is always
-- allowed to read their own project, regardless of membership.
-- This is semantically a no-op (the trigger creates an owner row
-- anyway) but it bypasses the snapshot-visibility race for RETURNING.

drop policy if exists "Members read project" on public.projects;

create policy "Members read project"
  on public.projects for select
  using (
    user_id = auth.uid()
    or public.is_project_member(id)
  );
