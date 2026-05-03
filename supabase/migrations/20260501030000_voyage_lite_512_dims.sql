-- Switch embedding columns from vector(1024) to vector(512) to match
-- Voyage's `voyage-3-lite` output (512-dim, ~4× cheaper and faster than
-- voyage-3 while still excellent for CAQDAS semantic retrieval).
--
-- Safe to run multiple times: drops dependent indexes/functions first,
-- truncates the (still-empty after the failed first ingest) embeddings,
-- then recreates everything against the new dimensionality.

-- 1. Drop functions that reference the old vector(1024) signature.
drop function if exists public.match_project_chunks(extensions.vector(1024), uuid, float, int);
drop function if exists public.match_project_quotations(extensions.vector(1024), uuid, float, int);

-- 2. Drop ivfflat indexes (they're tied to the column's type/dim).
drop index if exists public.document_chunks_embedding_idx;
drop index if exists public.quotations_embedding_idx;

-- 3. Wipe any partially-written 1024-dim rows so the type change can't
--    fail mid-cast. document_chunks is fully derived from documents and
--    will be repopulated on the next "Reprocesar"; quotation embeddings
--    are also lazy-rebuilt by embed-quotation on save.
truncate table public.document_chunks;
update public.quotations set embedding = null where embedding is not null;

-- 4. Switch the column types.
alter table public.document_chunks
  alter column embedding type extensions.vector(512) using null;

alter table public.quotations
  alter column embedding type extensions.vector(512) using null;

-- 5. Recreate ivfflat indexes for cosine similarity search.
create index document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

create index quotations_embedding_idx
  on public.quotations
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50);

-- 6. Recreate the semantic-retrieval RPCs with the new dimensionality.
create or replace function public.match_project_quotations(
  query_embedding extensions.vector(512),
  match_project_id uuid,
  match_threshold float default 0.45,
  match_count int default 10
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = extensions, public, pg_temp
as $$
  select
    q.id,
    q.document_id,
    q.content,
    1 - (q.embedding <=> query_embedding) as similarity
  from public.quotations q
  where q.project_id = match_project_id
    and q.embedding is not null
    and 1 - (q.embedding <=> query_embedding) > match_threshold
  order by q.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_project_chunks(
  query_embedding extensions.vector(512),
  match_project_id uuid,
  match_threshold float default 0.4,
  match_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = extensions, public, pg_temp
as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.project_id = match_project_id
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
