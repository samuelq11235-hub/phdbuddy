-- =====================================================
-- PHDBuddy F18 — Smart codes
-- =====================================================
-- A "smart code" is a virtual code whose membership comes from a
-- saved query (F11). Atlas.ti calls it the same. From the user's
-- perspective it shows in the codebook and behaves like any other
-- code, but its quotation list is *computed* from a query, not from
-- explicit quotation_codes rows.
--
-- We keep the regular `codes` table; smart codes just have a
-- `smart_query_id` link. The frontend resolves the membership at
-- read time by running the query.
-- =====================================================

alter table public.codes
  add column if not exists smart_query_id uuid
    references public.saved_queries (id) on delete set null;

create index if not exists codes_smart_query_idx
  on public.codes (smart_query_id)
  where smart_query_id is not null;

comment on column public.codes.smart_query_id is
  'If set, this code is a smart code: its quotation membership is the live result of saved_queries[smart_query_id], not explicit quotation_codes rows.';
