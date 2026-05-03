-- =====================================================
-- PHDBuddy initial schema
-- =====================================================

-- Extensions
create extension if not exists vector with schema extensions;

-- =====================================================
-- Enums
-- =====================================================

create type document_status as enum ('pending', 'processing', 'ready', 'error');
create type summary_length as enum ('short', 'medium', 'detailed');
create type connection_relation as enum ('similar', 'cites', 'cited_by', 'related');

-- =====================================================
-- profiles
-- =====================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  institution text,
  field_of_study text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- =====================================================
-- documents
-- =====================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  authors text[],
  doi text,
  year int,
  abstract text,
  source_url text,
  storage_path text not null,
  full_text text,
  status document_status not null default 'pending',
  error_message text,
  page_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_user_id_idx on public.documents (user_id);
create index documents_status_idx on public.documents (status);
create index documents_created_at_idx on public.documents (created_at desc);
create index documents_doi_idx on public.documents (doi) where doi is not null;

alter table public.documents enable row level security;

create policy "Users can view own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on public.documents for update
  using (auth.uid() = user_id);

create policy "Users can delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

-- =====================================================
-- document_chunks (with pgvector)
-- =====================================================

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  tokens int,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index document_chunks_document_id_idx on public.document_chunks (document_id);

-- IVFFlat index for cosine similarity search.
-- After loading data run: ANALYZE public.document_chunks;
create index document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

alter table public.document_chunks enable row level security;

create policy "Users can view own document chunks"
  on public.document_chunks for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

create policy "Service role manages chunks"
  on public.document_chunks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- summaries
-- =====================================================

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  length summary_length not null,
  content text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (document_id, length)
);

create index summaries_document_id_idx on public.summaries (document_id);

alter table public.summaries enable row level security;

create policy "Users can view own summaries"
  on public.summaries for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = summaries.document_id
        and d.user_id = auth.uid()
    )
  );

create policy "Service role manages summaries"
  on public.summaries for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- conclusions
-- =====================================================

create table public.conclusions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  key_findings jsonb,
  methodology text,
  limitations text,
  future_work text,
  results_summary text,
  model text not null,
  created_at timestamptz not null default now(),
  unique (document_id)
);

create index conclusions_document_id_idx on public.conclusions (document_id);

alter table public.conclusions enable row level security;

create policy "Users can view own conclusions"
  on public.conclusions for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = conclusions.document_id
        and d.user_id = auth.uid()
    )
  );

create policy "Service role manages conclusions"
  on public.conclusions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- external_papers (cached metadata from Semantic Scholar / Crossref / arXiv)
-- =====================================================

create table public.external_papers (
  id uuid primary key default gen_random_uuid(),
  semantic_scholar_id text unique,
  doi text,
  title text not null,
  authors text[],
  year int,
  abstract text,
  citation_count int,
  url text,
  venue text,
  created_at timestamptz not null default now()
);

create index external_papers_doi_idx on public.external_papers (doi) where doi is not null;
create index external_papers_title_idx on public.external_papers (title);

alter table public.external_papers enable row level security;

-- External papers are public reference data, readable by any authenticated user
create policy "Authenticated users can view external papers"
  on public.external_papers for select
  using (auth.role() = 'authenticated');

create policy "Service role manages external papers"
  on public.external_papers for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- connections
-- =====================================================

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_document_id uuid not null references public.documents (id) on delete cascade,
  target_document_id uuid references public.documents (id) on delete cascade,
  target_external_id uuid references public.external_papers (id) on delete cascade,
  relation_type connection_relation not null,
  score real,
  rationale text,
  created_at timestamptz not null default now(),
  check (
    (target_document_id is not null and target_external_id is null)
    or (target_document_id is null and target_external_id is not null)
  )
);

create index connections_user_id_idx on public.connections (user_id);
create index connections_source_document_id_idx on public.connections (source_document_id);
create unique index connections_source_target_doc_unique
  on public.connections (source_document_id, target_document_id)
  where target_document_id is not null;
create unique index connections_source_target_ext_unique
  on public.connections (source_document_id, target_external_id)
  where target_external_id is not null;

alter table public.connections enable row level security;

create policy "Users can view own connections"
  on public.connections for select
  using (auth.uid() = user_id);

create policy "Users can delete own connections"
  on public.connections for delete
  using (auth.uid() = user_id);

create policy "Service role manages connections"
  on public.connections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- updated_at trigger
-- =====================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- =====================================================
-- Auto-create profile when a user signs up
-- =====================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================
-- pgvector match RPC: find similar chunks across user's library
-- =====================================================

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1024),
  match_user_id uuid,
  match_threshold float default 0.7,
  match_count int default 10,
  exclude_document_id uuid default null
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
set search_path = extensions, public, pg_temp
as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.user_id = match_user_id
    and (exclude_document_id is null or dc.document_id <> exclude_document_id)
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- =====================================================
-- Storage bucket for uploaded PDFs
-- =====================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  52428800,
  array['application/pdf', 'text/plain', 'text/markdown']
)
on conflict (id) do nothing;

create policy "Users can read own files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload own files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update own files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
