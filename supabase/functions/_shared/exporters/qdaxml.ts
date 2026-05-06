// Exporter: REFI-QDA (QDA-XML + .qdpx)
// Standard: https://www.qdasoftware.org/refi-qda-project
// Version: REFI-QDA 1.5 (latest as of 2024)
//
// A .qdpx file is a ZIP containing:
//   project.qde  — main XML (UTF-8)
//   sources/     — original document text files (optional)
//
// We generate the .qde XML and zip it. No binary source files are
// bundled in F6 — the importer in a target tool will treat all
// sources as inline text.

// Deno: use the std/archive zip helper.
// We build a minimal in-memory ZIP with a single entry (project.qde).

interface ProjectRow { name: string; research_question: string | null; methodology: string | null; }
interface DocumentRow { id: string; title: string; kind: string; full_text: string | null; }
interface CodeRow { id: string; name: string; description: string | null; color: string; parent_id: string | null; }
interface QuotationRow {
  id: string;
  document_id: string;
  start_offset: number;
  end_offset: number;
  content: string;
  comment: string | null;
  codes: Array<{ code_id: string; created_by_ai: boolean }>;
}
interface MemoRow { id: string; title: string; kind: string; content: string; }

export interface QdaXmlInput {
  project: ProjectRow;
  documents: DocumentRow[];
  codes: CodeRow[];
  quotations: QuotationRow[];
  memos: MemoRow[];
}

function escapeXml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function guid(id: string): string {
  // PHDBuddy UUIDs are already UUID4 so we reuse them verbatim.
  return id;
}

function color6(hex: string): string {
  // QDE expects #RRGGBB or RRGGBB (6 hex chars). Normalise.
  return hex.replace(/^#/, "").padEnd(6, "0").slice(0, 6).toUpperCase();
}

function buildQde(input: QdaXmlInput): string {
  const { project, documents, codes, quotations, memos } = input;
  const now = new Date().toISOString();
  const projectGuid = crypto.randomUUID();

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<Project name="${escapeXml(project.name)}" origin="PHDBuddy" creatingUserGUID="${projectGuid}" creationDateTime="${now}" basePath=".">`);

  // --- Users (placeholder — real user auth isn't stored in QDE) ---
  lines.push(`  <Users>`);
  lines.push(`    <User guid="${projectGuid}" name="PHDBuddy Export" />`);
  lines.push(`  </Users>`);

  // --- CodeBook ---
  lines.push(`  <CodeBook>`);
  lines.push(`    <Codes>`);

  function renderCode(code: CodeRow, depth: number): void {
    const pad = "    ".repeat(depth + 2);
    const children = codes.filter((c) => c.parent_id === code.id);
    const isSelfClose = children.length === 0;
    const attrs = [
      `guid="${guid(code.id)}"`,
      `name="${escapeXml(code.name)}"`,
      `isCodable="true"`,
      `color="#${color6(code.color)}"`,
    ].join(" ");
    if (isSelfClose) {
      lines.push(`${pad}<Code ${attrs}>${code.description ? `<Description>${escapeXml(code.description)}</Description>` : ""}</Code>`);
    } else {
      lines.push(`${pad}<Code ${attrs}>`);
      if (code.description) {
        lines.push(`${pad}  <Description>${escapeXml(code.description)}</Description>`);
      }
      for (const child of children) renderCode(child, depth + 1);
      lines.push(`${pad}</Code>`);
    }
  }

  for (const root of codes.filter((c) => !c.parent_id)) renderCode(root, 0);
  lines.push(`    </Codes>`);
  lines.push(`  </CodeBook>`);

  // --- Sources (text documents) ---
  lines.push(`  <Sources>`);
  for (const doc of documents) {
    const quotas = quotations.filter((q) => q.document_id === doc.id);
    lines.push(`    <TextSource guid="${guid(doc.id)}" name="${escapeXml(doc.title)}" richTextPath="" plainTextPath="sources/${guid(doc.id)}.txt" creatingUser="${projectGuid}" creationDateTime="${now}">`);

    // PlainTextContent — inline for portability (target tool may not unzip sources/)
    if (doc.full_text) {
      const safe = escapeXml(doc.full_text);
      lines.push(`      <PlainTextContent>${safe}</PlainTextContent>`);
    }

    // Selections (quotations)
    if (quotas.length > 0) {
      lines.push(`      <TextSelections>`);
      for (const q of quotas) {
        lines.push(`        <TextSelection guid="${guid(q.id)}" startPosition="${q.start_offset}" endPosition="${q.end_offset}" creatingUser="${projectGuid}" creationDateTime="${now}">`);
        if (q.comment) {
          lines.push(`          <Description>${escapeXml(q.comment)}</Description>`);
        }
        // Coding references
        for (const c of q.codes) {
          lines.push(`          <Coding guid="${crypto.randomUUID()}" creatingUser="${projectGuid}" creationDateTime="${now}">`);
          lines.push(`            <CodeRef targetGUID="${guid(c.code_id)}" />`);
          lines.push(`          </Coding>`);
        }
        lines.push(`        </TextSelection>`);
      }
      lines.push(`      </TextSelections>`);
    }
    lines.push(`    </TextSource>`);
  }
  lines.push(`  </Sources>`);

  // --- Notes (memos) ---
  if (memos.length > 0) {
    lines.push(`  <Notes>`);
    for (const m of memos) {
      lines.push(`    <Note guid="${guid(m.id)}" name="${escapeXml(m.title)}" creatingUser="${projectGuid}" creationDateTime="${now}">`);
      lines.push(`      <PlainTextContent>${escapeXml(m.content)}</PlainTextContent>`);
      lines.push(`    </Note>`);
    }
    lines.push(`  </Notes>`);
  }

  lines.push(`</Project>`);
  return lines.join("\n");
}

// Minimal ZIP builder (no compression — deflate requires WASM).
// Stores entries with method=0 (STORED) which all ZIP readers support.
function zipStored(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);            // version needed (2.0)
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // method: STORED
    lv.setUint16(10, 0, true);            // mod time
    lv.setUint16(12, 0, true);            // mod date
    lv.setUint32(14, crc, true);          // CRC-32
    lv.setUint32(18, size, true);         // compressed
    lv.setUint32(22, size, true);         // uncompressed
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);            // extra length
    local.set(nameBytes, 30);

    offsets.push(offset);
    offset += 30 + nameBytes.length + size;
    localHeaders.push(concat(local, entry.data));

    // Central directory header
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);            // version made
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // method
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // CRC-32
    cv.setUint32(20, size, true);         // compressed
    cv.setUint32(24, size, true);         // uncompressed
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);            // extra
    cv.setUint16(32, 0, true);            // comment
    cv.setUint16(34, 0, true);            // disk start
    cv.setUint16(36, 0, true);            // int attributes
    cv.setUint32(38, 0, true);            // ext attributes
    cv.setUint32(42, offsets[offsets.length - 1], true); // local offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);
  }

  const cdStart = offset;
  const cdSize = centralHeaders.reduce((s, c) => s + c.length, 0);

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);

  const parts: Uint8Array[] = [...localHeaders, ...centralHeaders, eocd];
  return concat(...parts);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let pos = 0;
  for (const a of arrays) { out.set(a, pos); pos += a.length; }
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = CRC32_TABLE;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Pre-computed CRC-32 lookup table (standard polynomial 0xEDB88320).
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

export function buildQdpx(input: QdaXmlInput): Uint8Array {
  const qde = buildQde(input);
  const qdeBytes = new TextEncoder().encode(qde);

  // Also add source text files inside sources/ for full standard compliance.
  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: "project.qde", data: qdeBytes },
  ];
  for (const doc of input.documents) {
    if (doc.full_text) {
      entries.push({
        name: `sources/${doc.id}.txt`,
        data: new TextEncoder().encode(doc.full_text),
      });
    }
  }

  return zipStored(entries);
}

// -------------------------------------------------------
// Parser: .qdpx → PHDBuddy import shape
// -------------------------------------------------------
export interface ParsedQdaProject {
  name: string;
  codes: Array<{ guid: string; name: string; description: string; color: string; parentGuid: string | null }>;
  sources: Array<{ guid: string; name: string; text: string }>;
  selections: Array<{
    guid: string;
    sourceGuid: string;
    start: number;
    end: number;
    comment: string;
    codeGuids: string[];
  }>;
  memos: Array<{ guid: string; name: string; text: string }>;
}

export async function parseQdpx(zipBytes: Uint8Array): Promise<ParsedQdaProject> {
  // Extract project.qde from the zip.
  const qdeText = extractFileFromZip(zipBytes, "project.qde");
  if (!qdeText) throw new Error("No project.qde found in .qdpx archive");
  return parseQde(qdeText);
}

function extractFileFromZip(zip: Uint8Array, target: string): string | null {
  const enc = new TextDecoder();
  let pos = 0;
  while (pos < zip.length - 4) {
    const sig = (zip[pos] | (zip[pos+1]<<8) | (zip[pos+2]<<16) | (zip[pos+3]<<24)) >>> 0;
    if (sig !== 0x04034b50) { pos++; continue; }
    const nameLen = zip[pos+26] | (zip[pos+27]<<8);
    const extraLen = zip[pos+28] | (zip[pos+29]<<8);
    const compSize = zip[pos+18] | (zip[pos+19]<<8) | (zip[pos+20]<<16) | (zip[pos+21]<<24);
    const nameStart = pos + 30;
    const name = enc.decode(zip.slice(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (name === target) {
      const method = zip[pos+8] | (zip[pos+9]<<8);
      if (method !== 0) throw new Error(`Entry ${target} uses compression method ${method}; only STORED (0) is supported for parsing`);
      return enc.decode(zip.slice(dataStart, dataStart + compSize));
    }
    pos = dataStart + compSize;
  }
  return null;
}

function parseQde(xml: string): ParsedQdaProject {
  // Minimal regex-based parser — no DOM/XML lib available in Deno edge.
  function attr(tag: string, name: string): string {
    const m = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
    return m ? m[1] : "";
  }
  function innerText(tag: string, content: string): string {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(content);
    return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'") : "";
  }

  // Project name
  const projectTag = /<Project\s[^>]*>/i.exec(xml)?.[0] ?? "";
  const name = attr(projectTag, "name") || "Imported project";

  // Codes (recursive). We can't use a simple regex with `.*?` because that
  // would match the first `</Code>` it finds, which is the inner one for
  // nested codes — the parent->child hierarchy would be lost. Instead we
  // do a depth-aware sweep over <Code ...> open and </Code> close tokens.
  const codes: ParsedQdaProject["codes"] = [];
  function extractCodes(block: string, parentGuid: string | null) {
    const tagRe = /<Code(\s[^>]*?)?(\/?)>|<\/Code>/g;
    type Frame = { start: number; attrs: string; guid: string; parent: string | null };
    const stack: Frame[] = [];
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(block)) !== null) {
      const token = m[0];
      if (token === "</Code>") {
        const frame = stack.pop();
        if (!frame) continue;
        const innerStart = frame.start;
        const inner = block.slice(innerStart, m.index);
        const codeName = attr(frame.attrs, "name");
        const color = attr(frame.attrs, "color").replace("#", "");
        const description = innerText("Description", inner);
        if (frame.guid && codeName) {
          codes.push({ guid: frame.guid, name: codeName, description, color: color || "7C3AED", parentGuid: frame.parent });
        }
      } else {
        const attrs = m[1] ?? "";
        const selfClosing = m[2] === "/";
        const guid = attr(attrs, "guid");
        if (selfClosing) {
          const codeName = attr(attrs, "name");
          const color = attr(attrs, "color").replace("#", "");
          const parent = stack.length > 0 ? stack[stack.length - 1].guid : parentGuid;
          if (guid && codeName) {
            codes.push({ guid, name: codeName, description: "", color: color || "7C3AED", parentGuid: parent });
          }
        } else {
          const parent = stack.length > 0 ? stack[stack.length - 1].guid : parentGuid;
          stack.push({ start: tagRe.lastIndex, attrs, guid, parent });
        }
      }
    }
  }
  const codesBlock = /<Codes>([\s\S]*?)<\/Codes>/i.exec(xml)?.[1] ?? "";
  extractCodes(codesBlock, null);

  // Sources
  const sources: ParsedQdaProject["sources"] = [];
  const selections: ParsedQdaProject["selections"] = [];
  const srcRe = /<TextSource\s([^>]*)>([\s\S]*?)<\/TextSource>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = srcRe.exec(xml)) !== null) {
    const srcAttrs = sm[1];
    const srcInner = sm[2];
    const srcGuid = attr(srcAttrs, "guid");
    const srcName = attr(srcAttrs, "name");
    const text = innerText("PlainTextContent", srcInner);
    if (srcGuid) {
      sources.push({ guid: srcGuid, name: srcName, text });
      // Selections inside this source
      const selRe = /<TextSelection\s([^>]*)>([\s\S]*?)<\/TextSelection>/gi;
      let sel: RegExpExecArray | null;
      while ((sel = selRe.exec(srcInner)) !== null) {
        const selAttrs = sel[1];
        const selInner = sel[2];
        const selGuid = attr(selAttrs, "guid");
        const start = parseInt(attr(selAttrs, "startPosition") || "0", 10);
        const end = parseInt(attr(selAttrs, "endPosition") || "0", 10);
        const comment = innerText("Description", selInner);
        const codeGuids: string[] = [];
        const codeRefRe = /<CodeRef[^>]*targetGUID="([^"]+)"/gi;
        let cr: RegExpExecArray | null;
        while ((cr = codeRefRe.exec(selInner)) !== null) codeGuids.push(cr[1]);
        if (selGuid) selections.push({ guid: selGuid, sourceGuid: srcGuid, start, end, comment, codeGuids });
      }
    }
  }

  // Memos / Notes
  const memos: ParsedQdaProject["memos"] = [];
  const noteRe = /<Note\s([^>]*)>([\s\S]*?)<\/Note>/gi;
  let nm: RegExpExecArray | null;
  while ((nm = noteRe.exec(xml)) !== null) {
    const noteGuid = attr(nm[1], "guid");
    const noteTitle = attr(nm[1], "name");
    const noteText = innerText("PlainTextContent", nm[2]);
    if (noteGuid) memos.push({ guid: noteGuid, name: noteTitle, text: noteText });
  }

  return { name, codes, sources, selections, memos };
}
