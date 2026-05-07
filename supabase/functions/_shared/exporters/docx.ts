// Exporter: native OOXML .docx
// -----------------------------------------------------------------------
// Real Office Open XML (ECMA-376) zip — opens cleanly in Word, Pages,
// Google Docs, LibreOffice. We hand-roll the minimum set of parts:
//
//   [Content_Types].xml          — required, declares MIME of every part
//   _rels/.rels                  — required, points to the document part
//   word/document.xml            — the body
//   word/styles.xml              — paragraph + run styles for headings/quotes
//
// We don't ship images, embedded fonts, comments, or track-changes. The
// goal is a publication-ready report that survives any modern word
// processor with formatting (headings, bold, italic, blockquotes, tables,
// colored "code pills" for tags) intact.
//
// All text is escaped as XML and wrapped in <w:t xml:space="preserve">
// so leading/trailing whitespace is preserved. Newlines inside a single
// run are converted to <w:br/>.

import { zipStored } from "./zip.ts";

interface ProjectRow {
  name: string;
  research_question: string | null;
  methodology: string | null;
}
interface CodeRow {
  id: string;
  name: string;
  description: string | null;
  color?: string;
  usage_count: number;
  parent_id: string | null;
}
interface CodeGroupRow {
  id: string;
  name: string;
  description: string | null;
}
interface CodeGroupMemberRow {
  code_id: string;
  code_group_id: string;
}
interface QuotationRow {
  id: string;
  document_title: string;
  content: string;
  comment: string | null;
  codes: string[];
  sentiment_label: string | null;
}
interface MemoRow {
  title: string;
  kind: string;
  content: string;
}

export interface DocxExportInput {
  project: ProjectRow;
  codes: CodeRow[];
  codeGroups: CodeGroupRow[];
  codeGroupMembers: CodeGroupMemberRow[];
  quotations: QuotationRow[];
  memos: MemoRow[];
}

// XML 1.0 only allows tab, lf, cr and the unicode range 0x20-0xD7FF.
// Strip anything else so Word doesn't reject the file.
function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Renders one or more runs (`<w:r>`) for a piece of plain text.
 * Internal newlines become `<w:br/>` tags so multi-line strings in
 * blockquotes / memos survive without collapsing.
 */
function runs(text: string, opts: { bold?: boolean; italic?: boolean; color?: string; size?: number } = {}): string {
  if (!text) return "";
  const props: string[] = [];
  if (opts.bold) props.push("<w:b/>");
  if (opts.italic) props.push("<w:i/>");
  if (opts.color) props.push(`<w:color w:val="${opts.color}"/>`);
  if (opts.size) props.push(`<w:sz w:val="${opts.size * 2}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";

  const parts = text.split(/\r?\n/);
  return parts
    .map((part, i) => {
      const br = i < parts.length - 1 ? "<w:br/>" : "";
      const t = `<w:t xml:space="preserve">${esc(part)}</w:t>`;
      return `<w:r>${rPr}${t}${br}</w:r>`;
    })
    .join("");
}

function paragraph(content: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${content}</w:p>`;
}

function heading(text: string, level: 1 | 2 | 3 = 1): string {
  return paragraph(runs(text), `Heading${level}`);
}

function spacer(): string {
  return "<w:p/>";
}

/** Renders a quotation as a styled blockquote with a citation footer. */
function quotation(q: QuotationRow): string {
  const lines: string[] = [];
  lines.push(paragraph(runs(q.content, { italic: true }), "Quotation"));
  const meta: string[] = [`— ${q.document_title}`];
  if (q.codes.length > 0) meta.push(`Códigos: ${q.codes.join(", ")}`);
  if (q.sentiment_label) meta.push(`Sentimiento: ${q.sentiment_label}`);
  lines.push(
    paragraph(runs(meta.join(" · "), { color: "6B7280", size: 9 }), "QuotationMeta")
  );
  if (q.comment) {
    lines.push(paragraph(runs(`Comentario: ${q.comment}`, { color: "6B7280", size: 9 })));
  }
  return lines.join("");
}

function buildBody(input: DocxExportInput): string {
  const out: string[] = [];

  // Title page
  out.push(paragraph(runs(input.project.name), "Title"));
  if (input.project.research_question) {
    out.push(
      paragraph(
        runs("Pregunta de investigación: ", { bold: true }) +
          runs(input.project.research_question, { italic: true })
      )
    );
  }
  if (input.project.methodology) {
    out.push(
      paragraph(
        runs("Metodología: ", { bold: true }) + runs(input.project.methodology)
      )
    );
  }
  out.push(spacer());

  // Codebook
  out.push(heading("Codebook", 1));
  if (input.codes.length === 0) {
    out.push(paragraph(runs("(sin códigos)", { italic: true, color: "6B7280" })));
  } else {
    for (const c of input.codes) {
      const indent = "  ".repeat(depthOf(c, input.codes));
      out.push(
        paragraph(
          runs(`${indent}• `) +
            runs(c.name, { bold: true }) +
            runs(`  (${c.usage_count} usos)`, { color: "6B7280", size: 9 })
        )
      );
      if (c.description) {
        out.push(
          paragraph(runs(`${indent}    ${c.description}`, { color: "6B7280" }))
        );
      }
    }
  }
  out.push(spacer());

  // Code groups
  if (input.codeGroups.length > 0) {
    out.push(heading("Grupos de códigos", 1));
    const codesById = new Map(input.codes.map((c) => [c.id, c.name]));
    for (const g of input.codeGroups) {
      out.push(heading(g.name, 2));
      if (g.description) {
        out.push(paragraph(runs(g.description, { italic: true, color: "6B7280" })));
      }
      const members = input.codeGroupMembers
        .filter((m) => m.code_group_id === g.id)
        .map((m) => codesById.get(m.code_id) ?? "?")
        .filter(Boolean);
      if (members.length > 0) {
        out.push(paragraph(runs(members.join(", "))));
      }
    }
    out.push(spacer());
  }

  // Quotations
  out.push(heading("Citas", 1));
  if (input.quotations.length === 0) {
    out.push(paragraph(runs("(sin citas)", { italic: true, color: "6B7280" })));
  } else {
    // Group by document for readability.
    const byDoc = new Map<string, QuotationRow[]>();
    for (const q of input.quotations) {
      const key = q.document_title || "(documento)";
      const arr = byDoc.get(key) ?? [];
      arr.push(q);
      byDoc.set(key, arr);
    }
    for (const [docTitle, qs] of byDoc) {
      out.push(heading(docTitle, 2));
      for (const q of qs) out.push(quotation(q));
    }
  }
  out.push(spacer());

  // Memos
  if (input.memos.length > 0) {
    out.push(heading("Memos", 1));
    for (const m of input.memos) {
      out.push(heading(m.title, 2));
      out.push(
        paragraph(
          runs(`(${m.kind})`, { italic: true, color: "6B7280", size: 9 })
        )
      );
      out.push(paragraph(runs(m.content)));
    }
  }

  return out.join("");
}

function depthOf(c: CodeRow, all: CodeRow[]): number {
  let d = 0;
  let cur: CodeRow | undefined = c;
  const byId = new Map(all.map((x) => [x.id, x]));
  while (cur && cur.parent_id) {
    const next: CodeRow | undefined = byId.get(cur.parent_id);
    if (!next) break;
    cur = next;
    d++;
    if (d > 10) break;
  }
  return d;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/>
      <w:color w:val="1F2937"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1F2937"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="374151"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quotation">
    <w:name w:val="Quotation"/>
    <w:pPr>
      <w:ind w:left="360"/>
      <w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="6366F1"/></w:pBdr>
      <w:spacing w:before="80" w:after="40"/>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="374151"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="QuotationMeta">
    <w:name w:val="QuotationMeta"/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:after="160"/></w:pPr>
    <w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr>
  </w:style>
</w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function buildDocumentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

export function buildDocx(input: DocxExportInput): Uint8Array {
  const enc = new TextEncoder();
  const body = buildBody(input);
  const documentXml = buildDocumentXml(body);

  return zipStored([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS_XML) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS_XML) },
    { name: "word/document.xml", data: enc.encode(documentXml) },
    { name: "word/styles.xml", data: enc.encode(STYLES_XML) },
  ]);
}
