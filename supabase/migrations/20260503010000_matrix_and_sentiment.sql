-- =====================================================
-- PHDBuddy F3 — Code-Document Matrix + Sentiment
-- =====================================================
-- 1. RPC `code_document_matrix(p_project_id)` — counts of quotations per
--    (code_id, document_id) for the heatmap UI.
-- 2. Table `quotation_sentiment` — stores Claude-derived sentiment (polarity,
--    label, aspects, emotions) per quotation, one row at most per quotation.
--
-- Reference: PHDBUDDY_GAP_ANALYSIS.md, Phase 3.
-- =====================================================

-- -----------------------------------------------------
-- 1. code_document_matrix RPC
-- -----------------------------------------------------
-- Note: RLS on the underlying tables (`quotations`, `quotation_codes`) already
-- restricts visibility to the calling user, so this function is safe under
-- the default `security invoker` semantics — Postgres applies the caller's
-- policies during the join. We do NOT mark it security definer.

create or replace function public.code_document_matrix(p_project_id uuid)
returns table(
  code_id uuid,
  document_id uuid,
  count integer
)
language sql
stable
set search_path = public
as $$
  select
    qc.code_id,
    q.document_id,
    count(distinct q.id)::int as count
  from public.quotation_codes qc
  join public.quotations q on q.id = qc.quotation_id
  where q.project_id = p_project_id
  group by qc.code_id, q.document_id
$$;

comment on function public.code_document_matrix(uuid) is
  'Returns (code_id, document_id, count) tuples for a project, used by the F3 matrix heatmap.';

-- -----------------------------------------------------
-- 2. quotation_sentiment table
-- -----------------------------------------------------

do $$ begin
  create type public.sentiment_label as enum ('positive', 'negative', 'neutral', 'mixed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.quotation_sentiment (
  quotation_id uuid primary key references public.quotations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  polarity numeric(4, 3) not null check (polarity >= -1 and polarity <= 1),
  label public.sentiment_label not null,
  aspects jsonb not null default '[]'::jsonb,
  emotions text[] not null default array[]::text[],
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotation_sentiment_project_id_idx
  on public.quotation_sentiment (project_id);
create index if not exists quotation_sentiment_label_idx
  on public.quotation_sentiment (project_id, label);
create index if not exists quotation_sentiment_user_id_idx
  on public.quotation_sentiment (user_id);

alter table public.quotation_sentiment enable row level security;

drop policy if exists "Users manage own sentiment" on public.quotation_sentiment;
create policy "Users manage own sentiment"
  on public.quotation_sentiment for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role manages sentiment" on public.quotation_sentiment;
create policy "Service role manages sentiment"
  on public.quotation_sentiment for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists quotation_sentiment_set_updated_at on public.quotation_sentiment;
create trigger quotation_sentiment_set_updated_at
  before update on public.quotation_sentiment
  for each row execute function public.set_updated_at();
