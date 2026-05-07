// Minimal BibTeX parser. Handles the canonical Zotero/Mendeley export
// format which is what users will paste 99% of the time. We don't try
// to be a full Bib(La)TeX implementation — that's a multi-thousand-line
// state machine. Instead we cover:
//   @type{key, field = {value or "value"}, ...}
//   - braces and quotes for values, including nested braces
//   - line continuations (whitespace inside values is collapsed)
//   - basic LaTeX-escape stripping for { } \ & ' " ~ -- ---
//   - ignores comment lines starting with %
//
// Output: a normalised list of references the import flow turns into
// documents, with the raw entry preserved for round-tripping.

export interface BibEntry {
  type: string;
  citationKey: string;
  fields: Record<string, string>;
  raw: string;
}

export function parseBibtex(input: string): BibEntry[] {
  const entries: BibEntry[] = [];
  // Strip lines that start with `%` (BibTeX comment convention).
  const cleaned = input
    .split(/\r?\n/)
    .filter((l) => !l.match(/^\s*%/))
    .join("\n");

  // Walk the string entry-by-entry. We can't just split on '@' because
  // values may legitimately contain '@' inside braces.
  let i = 0;
  while (i < cleaned.length) {
    // Find the next '@' that starts an entry.
    const atIdx = cleaned.indexOf("@", i);
    if (atIdx < 0) break;
    // Skip @comment / @preamble / @string blocks — they aren't records.
    const peek = cleaned.slice(atIdx + 1, atIdx + 1 + 30).toLowerCase();
    if (
      peek.startsWith("comment") ||
      peek.startsWith("preamble") ||
      peek.startsWith("string")
    ) {
      // Walk past the matching brace block.
      const skipped = skipBalanced(cleaned, atIdx);
      i = skipped < 0 ? cleaned.length : skipped + 1;
      continue;
    }

    const openBrace = cleaned.indexOf("{", atIdx);
    if (openBrace < 0) break;
    const closeBrace = matchBrace(cleaned, openBrace);
    if (closeBrace < 0) break;

    const type = cleaned.slice(atIdx + 1, openBrace).trim().toLowerCase();
    const inner = cleaned.slice(openBrace + 1, closeBrace);

    // Citation key is everything up to the first comma (which delimits
    // the start of the field list).
    const firstComma = inner.indexOf(",");
    const citationKey = firstComma < 0
      ? inner.trim()
      : inner.slice(0, firstComma).trim();
    const fieldText = firstComma < 0 ? "" : inner.slice(firstComma + 1);

    const fields = parseFields(fieldText);
    entries.push({
      type,
      citationKey,
      fields,
      raw: cleaned.slice(atIdx, closeBrace + 1),
    });
    i = closeBrace + 1;
  }
  return entries;
}

function parseFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < text.length) {
    // Skip whitespace + commas between fields.
    while (pos < text.length && /[\s,]/.test(text[pos])) pos++;
    if (pos >= text.length) break;
    // Read field name (up to '=').
    const eqIdx = text.indexOf("=", pos);
    if (eqIdx < 0) break;
    const key = text.slice(pos, eqIdx).trim().toLowerCase();
    pos = eqIdx + 1;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length) break;

    let value = "";
    const c = text[pos];
    if (c === "{") {
      const end = matchBrace(text, pos);
      if (end < 0) break;
      value = text.slice(pos + 1, end);
      pos = end + 1;
    } else if (c === '"') {
      const end = text.indexOf('"', pos + 1);
      if (end < 0) break;
      value = text.slice(pos + 1, end);
      pos = end + 1;
    } else {
      // Unquoted (numeric or string-concat). We just read until comma
      // or end — this handles BibTeX years and similar.
      const next = text.indexOf(",", pos);
      const end = next < 0 ? text.length : next;
      value = text.slice(pos, end).trim();
      pos = end;
    }
    out[key] = cleanLatex(value);
  }
  return out;
}

// Returns the index of the matching '}' or -1 if unbalanced.
function matchBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipBalanced(text: string, atIdx: number): number {
  const open = text.indexOf("{", atIdx);
  if (open < 0) return -1;
  return matchBrace(text, open);
}

// Best-effort LaTeX → plain text cleanup. Not a full LaTeX renderer,
// just enough so the user doesn't see ugly braces in the resulting
// document title.
function cleanLatex(s: string): string {
  return s
    // Collapse whitespace runs.
    .replace(/\s+/g, " ")
    // Strip wrapping braces around words: {Author Surname} → Author Surname
    .replace(/\{([^{}]*)\}/g, "$1")
    // Common diacritic escapes — we lose accents but keep the letter.
    .replace(/\\['"`^~=.uvHrCo]\{?(\w)\}?/g, "$1")
    // Em/en dashes.
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    // Escaped braces / ampersands.
    .replace(/\\&/g, "&")
    .replace(/\\([{}])/g, "$1")
    // Leftover backslashes.
    .replace(/\\/g, "")
    .trim();
}

// Synthesises a sensible document title from a BibTeX entry. We prefer
// "Author (Year) — Title" so the documents list is easy to scan.
export function bibEntryTitle(entry: BibEntry): string {
  const author = entry.fields.author?.split(" and ")[0] ?? "";
  const surname = author.includes(",")
    ? author.split(",")[0].trim()
    : author.split(" ").slice(-1)[0]?.trim() ?? "";
  const year = (entry.fields.year ?? entry.fields.date ?? "").slice(0, 4);
  const title = entry.fields.title ?? entry.citationKey;
  const prefix = [surname, year ? `(${year})` : null].filter(Boolean).join(" ");
  return prefix ? `${prefix} — ${title}` : title;
}

// Builds the human-readable abstract/full_text content for the
// document we'll insert. We deliberately store more than just the
// abstract field so the document is searchable by author/journal/etc.
export function bibEntryFullText(entry: BibEntry): string {
  const f = entry.fields;
  const lines: string[] = [];
  if (f.author) lines.push(`Autores: ${f.author}`);
  if (f.year ?? f.date) lines.push(`Año: ${f.year ?? f.date}`);
  if (f.journal) lines.push(`Revista: ${f.journal}`);
  if (f.booktitle) lines.push(`Publicado en: ${f.booktitle}`);
  if (f.publisher) lines.push(`Editorial: ${f.publisher}`);
  if (f.volume) lines.push(`Volumen: ${f.volume}`);
  if (f.number) lines.push(`Número: ${f.number}`);
  if (f.pages) lines.push(`Páginas: ${f.pages}`);
  if (f.doi) lines.push(`DOI: ${f.doi}`);
  if (f.url) lines.push(`URL: ${f.url}`);
  if (f.keywords) lines.push(`Palabras clave: ${f.keywords}`);
  if (f.abstract) {
    lines.push("");
    lines.push("Resumen:");
    lines.push(f.abstract);
  }
  if (f.note) {
    lines.push("");
    lines.push("Notas:");
    lines.push(f.note);
  }
  return lines.join("\n");
}
