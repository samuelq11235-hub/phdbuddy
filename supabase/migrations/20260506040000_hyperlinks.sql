-- =====================================================
-- PHDBuddy F12 — Quotation hyperlinks
-- =====================================================
-- ATLAS.ti's signature feature: typed hyperlinks between *individual
-- quotations* (not codes). Lets researchers say "this quote *contradicts*
-- that one" or "this *explains* that one", preserving fine-grained
-- traceability that code-to-code networks (F4) cannot capture.
--
-- Reuses public.relation_types from F4 as the vocabulary, so the
-- semantic types are shared between code networks and quotation links.
--
-- Reference: PHDBUDDY_GAP_ANALYSIS.md — F12 follow-up (post-F11).
-- =====================================================

create table if not exists public.quotation_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  from_quotation_id uuid not null references public.quotations (id) on delete cascade,
  to_quotation_id uuid not null references public.quotations (id) on delete cascade,
  -- relation_type_id may be null while a user is in the middle of
  -- creating a link without picking a vocabulary entry yet, but the UI
  -- should require it before saving. Set to null if the relation type
  -- is later deleted (we don't want to lose the hyperlink itself).
  relation_type_id uuid references public.relation_types (id) on delete set null,
  comment text,
  created_at timestamptz not null default now(),
  -- A quotation can be linked to itself? No. Useful only for distinct
  -- pairs.
  constraint quotation_links_no_self_link check (from_quotation_id <> to_quotation_id)
);

-- Two quotations can be linked at most once *with the same relation
-- type* (you can have both "supports" and "explains" between the same
-- pair, that's fine). Coalesce so two NULL relation_type_ids dedup as
-- well.
create unique index if not exists quotation_links_unique_pair_and_type
  on public.quotation_links (
    from_quotation_id,
    to_quotation_id,
    coalesce(relation_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists quotation_links_project_idx on public.quotation_links (project_id);
create index if not exists quotation_links_from_idx on public.quotation_links (from_quotation_id);
create index if not exists quotation_links_to_idx on public.quotation_links (to_quotation_id);

alter table public.quotation_links enable row level security;

create policy "members_select_quotation_links"
  on public.quotation_links for select
  using (public.is_project_member(project_id));

create policy "writers_insert_quotation_links"
  on public.quotation_links for insert
  with check (
    public.can_write_project(project_id)
    and user_id = auth.uid()
  );

create policy "writers_update_quotation_links"
  on public.quotation_links for update
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  )
  with check (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "writers_delete_quotation_links"
  on public.quotation_links for delete
  using (
    public.can_write_project(project_id)
    and (user_id = auth.uid() or public.can_admin_project(project_id))
  );

create policy "service_role_quotation_links"
  on public.quotation_links for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.quotation_links is
  'Typed hyperlinks between two quotations. ATLAS.ti-style. Reuses public.relation_types as vocabulary.';
