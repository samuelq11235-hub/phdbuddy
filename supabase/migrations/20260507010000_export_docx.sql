-- =====================================================
-- F29.1 — Add 'docx' to public.export_format
-- =====================================================
-- Word-compatible export. We don't ship a full OOXML packager (that
-- would mean adding a 100KB+ ZIP+XML library to the edge function);
-- instead we emit Word-flavoured HTML with the right MIME type, which
-- Microsoft Word, LibreOffice Writer, and Pages all open natively as
-- a real word-processing document. Same trade-off Notion and Linear
-- make for their "Export as Word" feature.

alter type public.export_format add value if not exists 'docx';
