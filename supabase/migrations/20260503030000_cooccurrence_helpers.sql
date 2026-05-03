-- =====================================================
-- PHDBuddy — Co-occurrence helper RPCs
-- =====================================================
-- Powers the Code Co-occurrence Network module:
--   • shared_quotations_for_code_pair: returns the citations that have
--     BOTH codes attached, so clicking an edge in the graph can reveal
--     the underlying evidence.
--   • documents_for_code: returns the documents where a given code has
--     at least one quotation, with per-document quotation counts.
--
-- Both are SECURITY INVOKER + STABLE so they piggy-back on the existing
-- RLS policies of public.quotations / public.quotation_codes.
-- =====================================================

create or replace function public.shared_quotations_for_code_pair(
  p_project_id uuid,
  p_code_a uuid,
  p_code_b uuid
)
returns table (
  quotation_id uuid,
  document_id uuid,
  document_title text,
  start_offset int,
  end_offset int,
  content text,
  comment text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    q.id           as quotation_id,
    q.document_id  as document_id,
    d.title        as document_title,
    q.start_offset,
    q.end_offset,
    q.content,
    q.comment,
    q.created_at
  from public.quotations q
  join public.documents d on d.id = q.document_id
  join public.quotation_codes qa on qa.quotation_id = q.id and qa.code_id = p_code_a
  join public.quotation_codes qb on qb.quotation_id = q.id and qb.code_id = p_code_b
  where q.project_id = p_project_id
    and p_code_a <> p_code_b
  order by q.created_at desc;
$$;

comment on function public.shared_quotations_for_code_pair(uuid, uuid, uuid) is
  'Quotations annotated with BOTH codes — the evidence behind a cooccurrence edge.';


create or replace function public.documents_for_code(
  p_project_id uuid,
  p_code_id uuid
)
returns table (
  document_id uuid,
  document_title text,
  document_kind document_kind,
  quotation_count bigint,
  last_quoted_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    d.id    as document_id,
    d.title as document_title,
    d.kind  as document_kind,
    count(q.id)::bigint   as quotation_count,
    max(q.created_at)     as last_quoted_at
  from public.documents d
  join public.quotations q on q.document_id = d.id and q.project_id = p_project_id
  join public.quotation_codes qc on qc.quotation_id = q.id and qc.code_id = p_code_id
  where d.project_id = p_project_id
  group by d.id, d.title, d.kind
  order by quotation_count desc, last_quoted_at desc nulls last;
$$;

comment on function public.documents_for_code(uuid, uuid) is
  'Documents where a code is applied, with per-document quotation counts.';
