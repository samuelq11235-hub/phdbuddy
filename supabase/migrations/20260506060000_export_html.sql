-- =====================================================
-- PHDBuddy F16 — Add 'html' to export_format
-- =====================================================
-- We ship a self-contained HTML report (Atlas.ti has the same).
-- Single new enum value; idempotent.
-- =====================================================

do $$ begin
  alter type public.export_format add value if not exists 'html';
exception
  when duplicate_object then null;
end $$;
