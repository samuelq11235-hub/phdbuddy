-- Migration: multimedia support (F8 + F9 + F10)
-- Adds the document kinds image/audio/video, makes quotation offsets
-- nullable so non-text selections can be stored, introduces a
-- selection_meta jsonb column for area- or time-based selections, and
-- creates the document_transcript table backing audio/video viewers.

set search_path = public, extensions;

-- -----------------------------------------------------
-- 1. Extend document_kind with multimedia values.
-- -----------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'document_kind' and e.enumlabel = 'image'
  ) then
    alter type document_kind add value 'image';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'document_kind' and e.enumlabel = 'audio'
  ) then
    alter type document_kind add value 'audio';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'document_kind' and e.enumlabel = 'video'
  ) then
    alter type document_kind add value 'video';
  end if;
end$$;

-- -----------------------------------------------------
-- 2. Loosen quotation offsets and add selection_meta.
-- -----------------------------------------------------
-- The CHECK (end_offset > start_offset) becomes invalid when both are
-- null (image / audio quotations). We replace it with a constraint that
-- accepts nulls but still enforces ordering when both are present.

alter table public.quotations
  alter column start_offset drop not null,
  alter column end_offset   drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%end_offset > start_offset%'
  ) then
    alter table public.quotations
      drop constraint quotations_check;
  end if;
end$$;

alter table public.quotations
  add constraint quotations_offset_order_chk
    check (
      start_offset is null
      or end_offset is null
      or end_offset > start_offset
    );

-- selection_meta describes non-text selections:
--   { type: 'text' }                                              (default)
--   { type: 'image_area', bbox: [x, y, w, h], page?: int }
--   { type: 'timerange', startMs: int, endMs: int }
alter table public.quotations
  add column if not exists selection_meta jsonb not null default '{"type":"text"}'::jsonb;

create index if not exists quotations_selection_kind_idx
  on public.quotations ((selection_meta->>'type'));

-- -----------------------------------------------------
-- 3. document_transcript: per-segment audio/video transcript rows.
-- -----------------------------------------------------
create table if not exists public.document_transcript (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  segment_index int not null,
  start_ms int not null,
  end_ms int not null,
  text text not null,
  speaker text,
  confidence real,
  created_at timestamptz not null default now(),
  unique (document_id, segment_index)
);

create index if not exists document_transcript_doc_idx
  on public.document_transcript (document_id, segment_index);

alter table public.document_transcript enable row level security;

-- Inherit access from the parent document via project membership.
drop policy if exists "Project members read transcripts" on public.document_transcript;
create policy "Project members read transcripts"
  on public.document_transcript for select
  to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_transcript.document_id
        and public.is_project_member(d.project_id)
    )
  );

drop policy if exists "Service role manages transcripts" on public.document_transcript;
create policy "Service role manages transcripts"
  on public.document_transcript for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- -----------------------------------------------------
-- 4. Storage bucket extension: allow common multimedia mime types.
-- -----------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
  -- text
  'text/plain', 'text/markdown', 'application/pdf',
  -- images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  -- audio
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'audio/ogg', 'audio/mp4', 'audio/x-m4a',
  -- video
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
  -- generic
  'application/octet-stream'
],
file_size_limit = 524288000  -- 500 MiB for video
where id = 'documents';
