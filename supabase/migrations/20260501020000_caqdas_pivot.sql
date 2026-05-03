-- =====================================================
-- PHDBuddy CAQDAS pivot
-- =====================================================
-- This migration pivots the project from a paper-summarization tool
-- into a Computer-Assisted Qualitative Data Analysis (CAQDAS) workspace
-- in the spirit of Atlas.ti / NVivo / MAXQDA, with AI as a first-class
-- citizen (auto-coding, theme discovery, conversational analysis).
-- =====================================================

-- -----------------------------------------------------
-- 1. Drop legacy paper-summarization tables / types
-- -----------------------------------------------------

drop function if exists public.match_document_chunks(extensions.vector(1024), uuid, float, int, uuid);
drop table if exists public.connections cascade;
drop table if exists public.external_papers cascade;
drop table if exists public.conclusions cascade;
drop table if exists public.summaries cascade;
drop table if exists public.document_chunks cascade;
drop table if exists public.documents cascade;

drop type if exists connection_relation;
drop type if exists summary_length;

-- Keep: profiles, document_status enum, set_updated_at(), handle_new_user()

-- -----------------------------------------------------
-- 2. New enums
-- -----------------------------------------------------

create type document_kind as enum (
  'interview',
  'focus_group',
  'field_notes',
  'survey',
  'literature',
  'transcript',
  'other'
);

create type memo_type as enum ('analytic', 'methodological', 'theoretical', 'reflective');
create type ai_suggestion_status as enum ('pending', 'accepted', 'rejected', 'applied');
create type ai_suggestion_type as enum ('code', 'quotation', 'theme', 'codebook');
create type chat_role as enum ('user', 'assistant', 'system');

-- -----------------------------------------------------
-- 3. projects (top-level container — a research study)
-- -----------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  research_question text,
  methodology text,
  color text not null default '#7C3AED',
  document_count int not null default 0,
  code_count int not null default 0,
  quotation_count int not null default 0,
  memo_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);
create index projects_updated_at_idx on public.projects (updated_at desc);

alter table public.projects enable row level security;

create policy "Users manage own projects"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 4. documents (project-scoped sources)
-- -----------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  kind document_kind not null default 'other',
  source_metadata jsonb not null default '{}'::jsonb,
  storage_path text,
  full_text text,
  status document_status not null default 'pending',
  error_message text,
  page_count int,
  word_count int,
  quotation_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_project_id_idx on public.documents (project_id);
create index documents_user_id_idx on public.documents (user_id);
create index documents_status_idx on public.documents (status);

alter table public.documents enable row level security;

create policy "Users manage own documents"
  on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 5. document_chunks (with pgvector — for chat & discovery)
-- -----------------------------------------------------

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  start_offset int,
  end_offset int,
  tokens int,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index document_chunks_document_id_idx on public.document_chunks (document_id);
create index document_chunks_project_id_idx on public.document_chunks (project_id);
create index document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

alter table public.document_chunks enable row level security;

create policy "Users view chunks of own docs"
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

-- -----------------------------------------------------
-- 6. codes (hierarchical labels — the codebook)
-- -----------------------------------------------------

create table public.codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.codes (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#7C3AED',
  created_by_ai boolean not null default false,
  usage_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index codes_unique_name_per_parent
  on public.codes (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index codes_project_id_idx on public.codes (project_id);
create index codes_parent_id_idx on public.codes (parent_id);

alter table public.codes enable row level security;

create policy "Users manage own codes"
  on public.codes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger codes_set_updated_at
  before update on public.codes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 7. quotations (text segments — coded units of meaning)
-- -----------------------------------------------------

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  start_offset int not null,
  end_offset int not null,
  content text not null,
  comment text,
  embedding extensions.vector(1024),
  created_by_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_offset > start_offset)
);

create index quotations_project_id_idx on public.quotations (project_id);
create index quotations_document_id_idx on public.quotations (document_id);
create index quotations_user_id_idx on public.quotations (user_id);
create index quotations_embedding_idx
  on public.quotations
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50);

alter table public.quotations enable row level security;

create policy "Users manage own quotations"
  on public.quotations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger quotations_set_updated_at
  before update on public.quotations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 8. quotation_codes (m2m — the coding act)
-- -----------------------------------------------------

create table public.quotation_codes (
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  code_id uuid not null references public.codes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by_ai boolean not null default false,
  ai_confidence real,
  created_at timestamptz not null default now(),
  primary key (quotation_id, code_id)
);

create index quotation_codes_code_id_idx on public.quotation_codes (code_id);
create index quotation_codes_user_id_idx on public.quotation_codes (user_id);

alter table public.quotation_codes enable row level security;

create policy "Users manage own coding"
  on public.quotation_codes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------
-- 9. memos (analytic notes)
-- -----------------------------------------------------

create table public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  content text not null default '',
  kind memo_type not null default 'analytic',
  linked_code_ids uuid[] not null default '{}',
  linked_quotation_ids uuid[] not null default '{}',
  linked_document_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memos_project_id_idx on public.memos (project_id);
create index memos_user_id_idx on public.memos (user_id);

alter table public.memos enable row level security;

create policy "Users manage own memos"
  on public.memos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger memos_set_updated_at
  before update on public.memos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- 10. ai_suggestions (review-before-accept queue)
-- -----------------------------------------------------

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  kind ai_suggestion_type not null,
  payload jsonb not null,
  status ai_suggestion_status not null default 'pending',
  model text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index ai_suggestions_project_idx on public.ai_suggestions (project_id);
create index ai_suggestions_status_idx on public.ai_suggestions (project_id, status);

alter table public.ai_suggestions enable row level security;

create policy "Users manage own suggestions"
  on public.ai_suggestions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Service role manages suggestions"
  on public.ai_suggestions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 11. chat_sessions + chat_messages (project chat)
-- -----------------------------------------------------

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_sessions_project_idx on public.chat_sessions (project_id, updated_at desc);

alter table public.chat_sessions enable row level security;

create policy "Users manage own sessions"
  on public.chat_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger chat_sessions_set_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role chat_role not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

alter table public.chat_messages enable row level security;

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

create policy "Service role manages chat messages"
  on public.chat_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 12. Denormalized counters via triggers
-- -----------------------------------------------------

create or replace function public.bump_project_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    if (tg_table_name = 'documents') then
      update public.projects set document_count = document_count + 1 where id = new.project_id;
    elsif (tg_table_name = 'codes') then
      update public.projects set code_count = code_count + 1 where id = new.project_id;
    elsif (tg_table_name = 'quotations') then
      update public.projects set quotation_count = quotation_count + 1 where id = new.project_id;
      update public.documents set quotation_count = quotation_count + 1 where id = new.document_id;
    elsif (tg_table_name = 'memos') then
      update public.projects set memo_count = memo_count + 1 where id = new.project_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if (tg_table_name = 'documents') then
      update public.projects set document_count = greatest(0, document_count - 1) where id = old.project_id;
    elsif (tg_table_name = 'codes') then
      update public.projects set code_count = greatest(0, code_count - 1) where id = old.project_id;
    elsif (tg_table_name = 'quotations') then
      update public.projects set quotation_count = greatest(0, quotation_count - 1) where id = old.project_id;
      update public.documents set quotation_count = greatest(0, quotation_count - 1) where id = old.document_id;
    elsif (tg_table_name = 'memos') then
      update public.projects set memo_count = greatest(0, memo_count - 1) where id = old.project_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger documents_bump_count
  after insert or delete on public.documents
  for each row execute function public.bump_project_counts();

create trigger codes_bump_count
  after insert or delete on public.codes
  for each row execute function public.bump_project_counts();

create trigger quotations_bump_count
  after insert or delete on public.quotations
  for each row execute function public.bump_project_counts();

create trigger memos_bump_count
  after insert or delete on public.memos
  for each row execute function public.bump_project_counts();

create or replace function public.bump_code_usage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.codes set usage_count = usage_count + 1 where id = new.code_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.codes set usage_count = greatest(0, usage_count - 1) where id = old.code_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger quotation_codes_bump_usage
  after insert or delete on public.quotation_codes
  for each row execute function public.bump_code_usage();

-- -----------------------------------------------------
-- 13. Vector RPCs (semantic retrieval within a project)
-- -----------------------------------------------------

create or replace function public.match_project_quotations(
  query_embedding extensions.vector(1024),
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
  query_embedding extensions.vector(1024),
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

-- -----------------------------------------------------
-- 14. Code co-occurrence matrix (network graph data)
-- -----------------------------------------------------

create or replace function public.code_cooccurrence(match_project_id uuid)
returns table (code_a uuid, code_b uuid, occurrences bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select qc1.code_id as code_a, qc2.code_id as code_b, count(*)::bigint as occurrences
  from public.quotation_codes qc1
  join public.quotation_codes qc2
    on qc1.quotation_id = qc2.quotation_id
   and qc1.code_id < qc2.code_id
  join public.quotations q on q.id = qc1.quotation_id
  where q.project_id = match_project_id
  group by qc1.code_id, qc2.code_id
  order by occurrences desc;
$$;
