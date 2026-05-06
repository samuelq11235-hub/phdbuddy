// Exporter: Markdown
// Produces a structured report suitable for reading or pasting into a doc.
//
// Structure:
//   # Project name
//   Research question / methodology
//   ## Codebook
//     ### Code (usage_count)
//       description
//       - "quotation 1" (document title)
//       - "quotation 2" ...
//   ## Code Groups
//   ## Memos

interface ProjectRow { name: string; research_question: string | null; methodology: string | null; }
interface CodeRow { id: string; name: string; description: string | null; usage_count: number; parent_id: string | null; }
interface CodeGroupRow { id: string; name: string; description: string | null; }
interface CodeGroupMemberRow { code_id: string; code_group_id: string; }
interface QuotationRow {
  id: string;
  document_title: string;
  content: string;
  comment: string | null;
  codes: string[];
  sentiment_label: string | null;
}
interface MemoRow { title: string; kind: string; content: string; }

export interface MarkdownExportInput {
  project: ProjectRow;
  codes: CodeRow[];
  codeGroups: CodeGroupRow[];
  codeGroupMembers: CodeGroupMemberRow[];
  quotations: QuotationRow[];
  memos: MemoRow[];
}

function indent(level: number): string {
  return "  ".repeat(level);
}

export function buildMarkdown(input: MarkdownExportInput): Uint8Array {
  const { project, codes, codeGroups, codeGroupMembers, quotations, memos } = input;
  const lines: string[] = [];

  // Header
  lines.push(`# ${project.name}`);
  lines.push("");
  if (project.research_question) {
    lines.push(`**Pregunta de investigación:** ${project.research_question}`);
  }
  if (project.methodology) {
    lines.push(`**Metodología:** ${project.methodology}`);
  }
  lines.push("");
  lines.push(`*Generado por PHDBuddy el ${new Date().toLocaleString("es-ES")}*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // --- Codebook ---
  lines.push("## Codebook");
  lines.push("");

  const codeById = new Map(codes.map((c) => [c.id, c]));
  const quotationsByCode = new Map<string, QuotationRow[]>();
  for (const q of quotations) {
    for (const codeId of q.codes) {
      const arr = quotationsByCode.get(codeId) ?? [];
      arr.push(q);
      quotationsByCode.set(codeId, arr);
    }
  }

  // Only top-level codes at the first pass; children inline.
  const rendered = new Set<string>();

  function renderCode(code: CodeRow, depth: number) {
    if (rendered.has(code.id)) return;
    rendered.add(code.id);

    const prefix = "#".repeat(Math.min(depth + 3, 6));
    lines.push(`${prefix} ${code.name} *(${code.usage_count} citas)*`);
    lines.push("");
    if (code.description) {
      lines.push(`${indent(depth)}${code.description}`);
      lines.push("");
    }
    const codeQuotes = quotationsByCode.get(code.id) ?? [];
    for (const q of codeQuotes.slice(0, 20)) {
      lines.push(`${indent(depth)}- > "${q.content.trim().replace(/\n/g, " ")}" *(${q.document_title})*`);
    }
    if (codeQuotes.length > 20) {
      lines.push(`${indent(depth)}- *(${codeQuotes.length - 20} citas más…)*`);
    }
    lines.push("");

    // Children
    const children = codes.filter((c) => c.parent_id === code.id);
    for (const child of children) renderCode(child, depth + 1);
  }

  const roots = codes.filter((c) => !c.parent_id);
  for (const root of roots) renderCode(root, 0);

  // Ungrouped code check (all children already shown recursively).
  lines.push("---");
  lines.push("");

  // --- Code Groups ---
  if (codeGroups.length > 0) {
    lines.push("## Grupos de códigos");
    lines.push("");
    const membersByGroup = new Map<string, string[]>();
    for (const m of codeGroupMembers) {
      const arr = membersByGroup.get(m.code_group_id) ?? [];
      arr.push(m.code_id);
      membersByGroup.set(m.code_group_id, arr);
    }
    for (const g of codeGroups) {
      lines.push(`### ${g.name}`);
      if (g.description) lines.push(`*${g.description}*`);
      const members = membersByGroup.get(g.id) ?? [];
      for (const cid of members) {
        const code = codeById.get(cid);
        if (code) lines.push(`- ${code.name}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // --- Memos ---
  if (memos.length > 0) {
    lines.push("## Memos");
    lines.push("");
    const kindLabel: Record<string, string> = {
      analytic: "Analítico",
      methodological: "Metodológico",
      theoretical: "Teórico",
      reflective: "Reflexivo",
    };
    for (const m of memos) {
      lines.push(`### ${m.title}`);
      lines.push(`*${kindLabel[m.kind] ?? m.kind}*`);
      lines.push("");
      if (m.content.trim()) {
        lines.push(m.content.trim());
      }
      lines.push("");
    }
  }

  return new TextEncoder().encode(lines.join("\n"));
}
