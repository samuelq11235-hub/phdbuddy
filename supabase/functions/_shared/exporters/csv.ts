// Exporter: CSV
// Produces a UTF-8 BOM-prefixed CSV so Excel opens it correctly.
// Columns:
//   quotation_id, document_title, document_kind, content,
//   codes, comment, sentiment_label, created_at

export interface CsvRow {
  quotation_id: string;
  document_title: string;
  document_kind: string;
  content: string;
  codes: string;          // comma-joined code names
  comment: string;
  sentiment_label: string;
  created_at: string;
}

function escapeCell(value: string): string {
  // Wrap in double-quotes, escape inner double-quotes by doubling them.
  const str = value ?? "";
  return `"${str.replace(/"/g, '""')}"`;
}

const HEADERS: Array<keyof CsvRow> = [
  "quotation_id",
  "document_title",
  "document_kind",
  "content",
  "codes",
  "comment",
  "sentiment_label",
  "created_at",
];

export function buildCsv(rows: CsvRow[]): Uint8Array {
  const BOM = "\uFEFF";
  const header = HEADERS.join(",");
  const body = rows
    .map((r) => HEADERS.map((k) => escapeCell(r[k])).join(","))
    .join("\r\n");
  const text = `${BOM}${header}\r\n${body}`;
  return new TextEncoder().encode(text);
}
