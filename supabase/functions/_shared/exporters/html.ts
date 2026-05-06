// Exporter: HTML report
// Produces a self-contained, navigable HTML document with the same
// data the markdown exporter renders, plus a sticky sidebar TOC and
// minimal styles. No external CSS/JS dependencies — opens cleanly
// from disk without a server, prints to PDF nicely from any browser.
//
// Design choices:
// - Inline CSS (no fetch in print preview).
// - System font stack so it doesn't look amateurish.
// - Anchor links from the sidebar to each code/memo.
// - Quotation blocks use <blockquote> with citation footer for accessible
//   semantics + reasonable defaults in word processors that import HTML.

interface ProjectRow { name: string; research_question: string | null; methodology: string | null; }
interface CodeRow { id: string; name: string; description: string | null; color?: string; usage_count: number; parent_id: string | null; }
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

export interface HtmlExportInput {
  project: ProjectRow;
  codes: CodeRow[];
  codeGroups: CodeGroupRow[];
  codeGroupMembers: CodeGroupMemberRow[];
  quotations: QuotationRow[];
  memos: MemoRow[];
}

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

const STYLES = `
:root {
  color-scheme: light dark;
  --fg: #0f172a;
  --muted: #475569;
  --bg: #ffffff;
  --panel: #f8fafc;
  --border: #e2e8f0;
  --accent: #7c3aed;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e2e8f0; --muted: #94a3b8; --bg: #0f172a; --panel: #1e293b; --border: #334155; }
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, "Helvetica Neue", sans-serif;
  color: var(--fg);
  background: var(--bg);
  margin: 0;
  line-height: 1.55;
}
.layout { display: grid; grid-template-columns: 280px 1fr; max-width: 1280px; margin: 0 auto; }
nav.toc {
  position: sticky; top: 0; align-self: start;
  height: 100vh; overflow-y: auto;
  padding: 1.5rem 1rem;
  border-right: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.9rem;
}
nav.toc h2 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 1rem 0 .5rem; }
nav.toc ul { list-style: none; padding: 0; margin: 0; }
nav.toc li { margin: .25rem 0; }
nav.toc a { color: inherit; text-decoration: none; display: block; padding: .25rem .5rem; border-radius: 4px; }
nav.toc a:hover { background: var(--border); }
main { padding: 2rem 3rem; max-width: 900px; }
header.hero h1 { margin: 0 0 .5rem; font-size: 2rem; }
header.hero .meta { color: var(--muted); }
section { margin: 3rem 0; }
h2 { border-bottom: 2px solid var(--accent); padding-bottom: .25rem; }
h3 { display: flex; align-items: baseline; gap: .5rem; margin-top: 2rem; }
.code-color { display: inline-block; width: 12px; height: 12px; border-radius: 50%; }
.code-count { font-size: 0.8rem; color: var(--muted); font-weight: normal; }
.code-desc { color: var(--muted); font-size: 0.95rem; margin: .25rem 0 .75rem; }
blockquote {
  margin: .5rem 0;
  padding: .5rem .75rem;
  border-left: 3px solid var(--accent);
  background: var(--panel);
  font-size: 0.95rem;
}
blockquote .cite { display: block; font-size: 0.8rem; color: var(--muted); margin-top: .25rem; }
.sentiment { display: inline-block; padding: 0 .4rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; margin-left: .25rem; }
.sentiment.positive { background: #dcfce7; color: #166534; }
.sentiment.negative { background: #fee2e2; color: #991b1b; }
.sentiment.mixed { background: #fef3c7; color: #92400e; }
.sentiment.neutral { background: var(--border); color: var(--muted); }
.memo { padding: 1rem; border: 1px solid var(--border); border-radius: 8px; margin: 1rem 0; }
.memo .memo-kind { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); }
.children { margin-left: 1.5rem; }
@media print {
  nav.toc { display: none; }
  .layout { grid-template-columns: 1fr; }
  main { padding: 1rem; max-width: 100%; }
  blockquote, .memo { break-inside: avoid; }
}
`;

export function buildHtml(input: HtmlExportInput): Uint8Array {
  const { project, codes, codeGroups, codeGroupMembers, quotations, memos } = input;

  const codeById = new Map(codes.map((c) => [c.id, c]));
  const quotationsByCode = new Map<string, QuotationRow[]>();
  for (const q of quotations) {
    for (const codeId of q.codes) {
      const arr = quotationsByCode.get(codeId) ?? [];
      arr.push(q);
      quotationsByCode.set(codeId, arr);
    }
  }

  const rendered = new Set<string>();
  const tocCodes: Array<{ id: string; name: string; depth: number }> = [];

  function renderCodeBlock(code: CodeRow, depth: number, parts: string[]) {
    if (rendered.has(code.id)) return;
    rendered.add(code.id);
    tocCodes.push({ id: code.id, name: code.name, depth });
    const dot = code.color ? `<span class="code-color" style="background:${esc(code.color)}"></span>` : "";
    parts.push(`<div class="children" style="margin-left:${depth * 1.5}rem">`);
    parts.push(`<h3 id="code-${slug(code.id)}">${dot}${esc(code.name)} <span class="code-count">(${code.usage_count} citas)</span></h3>`);
    if (code.description) parts.push(`<p class="code-desc">${esc(code.description)}</p>`);
    const codeQuotes = quotationsByCode.get(code.id) ?? [];
    for (const q of codeQuotes.slice(0, 25)) {
      const sentClass = q.sentiment_label ? esc(q.sentiment_label.toLowerCase()) : "";
      const sent = q.sentiment_label
        ? `<span class="sentiment ${sentClass}">${esc(q.sentiment_label)}</span>`
        : "";
      parts.push(
        `<blockquote>${esc(q.content.trim()).replace(/\n/g, "<br>")}${sent}<span class="cite">— ${esc(q.document_title)}${q.comment ? ` · ${esc(q.comment)}` : ""}</span></blockquote>`
      );
    }
    if (codeQuotes.length > 25) {
      parts.push(`<p class="code-desc"><em>(${codeQuotes.length - 25} citas más no mostradas)</em></p>`);
    }
    const children = codes.filter((c) => c.parent_id === code.id);
    for (const ch of children) renderCodeBlock(ch, depth + 1, parts);
    parts.push(`</div>`);
  }

  const codeParts: string[] = [];
  for (const root of codes.filter((c) => !c.parent_id)) {
    renderCodeBlock(root, 0, codeParts);
  }

  // --- Code groups
  const groupParts: string[] = [];
  if (codeGroups.length > 0) {
    const membersByGroup = new Map<string, string[]>();
    for (const m of codeGroupMembers) {
      const arr = membersByGroup.get(m.code_group_id) ?? [];
      arr.push(m.code_id);
      membersByGroup.set(m.code_group_id, arr);
    }
    for (const g of codeGroups) {
      groupParts.push(`<h3 id="group-${slug(g.id)}">${esc(g.name)}</h3>`);
      if (g.description) groupParts.push(`<p class="code-desc">${esc(g.description)}</p>`);
      const members = membersByGroup.get(g.id) ?? [];
      groupParts.push(`<ul>`);
      for (const cid of members) {
        const code = codeById.get(cid);
        if (code) groupParts.push(`<li>${esc(code.name)}</li>`);
      }
      groupParts.push(`</ul>`);
    }
  }

  // --- Memos
  const kindLabel: Record<string, string> = {
    analytic: "Analítico",
    methodological: "Metodológico",
    theoretical: "Teórico",
    reflective: "Reflexivo",
  };
  const memoParts: string[] = [];
  for (const m of memos) {
    memoParts.push(`<div class="memo" id="memo-${slug(m.title)}">`);
    memoParts.push(`<div class="memo-kind">${esc(kindLabel[m.kind] ?? m.kind)}</div>`);
    memoParts.push(`<h3 style="margin-top:0">${esc(m.title)}</h3>`);
    memoParts.push(`<div>${esc(m.content.trim()).replace(/\n/g, "<br>")}</div>`);
    memoParts.push(`</div>`);
  }

  // --- TOC
  const tocParts: string[] = [];
  tocParts.push(`<h2>Codebook</h2><ul>`);
  for (const c of tocCodes) {
    tocParts.push(`<li style="padding-left:${c.depth * 0.75}rem"><a href="#code-${slug(c.id)}">${esc(c.name)}</a></li>`);
  }
  tocParts.push(`</ul>`);
  if (codeGroups.length > 0) {
    tocParts.push(`<h2>Grupos</h2><ul>`);
    for (const g of codeGroups) {
      tocParts.push(`<li><a href="#group-${slug(g.id)}">${esc(g.name)}</a></li>`);
    }
    tocParts.push(`</ul>`);
  }
  if (memos.length > 0) {
    tocParts.push(`<h2>Memos</h2><ul>`);
    for (const m of memos) {
      tocParts.push(`<li><a href="#memo-${slug(m.title)}">${esc(m.title)}</a></li>`);
    }
    tocParts.push(`</ul>`);
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(project.name)} — Informe</title>
<style>${STYLES}</style>
</head>
<body>
<div class="layout">
<nav class="toc">
<h2 style="margin-top:0">${esc(project.name)}</h2>
${tocParts.join("\n")}
</nav>
<main>
<header class="hero">
<h1>${esc(project.name)}</h1>
${project.research_question ? `<p><strong>Pregunta de investigación:</strong> ${esc(project.research_question)}</p>` : ""}
${project.methodology ? `<p><strong>Metodología:</strong> ${esc(project.methodology)}</p>` : ""}
<p class="meta">Generado por PHDBuddy el ${esc(new Date().toLocaleString("es-ES"))}</p>
</header>
<section>
<h2>Codebook</h2>
${codeParts.join("\n")}
</section>
${codeGroups.length > 0 ? `<section><h2>Grupos de códigos</h2>${groupParts.join("\n")}</section>` : ""}
${memos.length > 0 ? `<section><h2>Memos</h2>${memoParts.join("\n")}</section>` : ""}
</main>
</div>
</body>
</html>`;

  return new TextEncoder().encode(html);
}
