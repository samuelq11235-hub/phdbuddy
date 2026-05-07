// Exporter: Word-compatible document
// Wraps the HTML report in a Microsoft Office–flavoured envelope so
// Word/Pages/LibreOffice open it as a real word-processing document
// instead of a webpage. Same idea as Linear/Notion's "Export as Word":
// we don't ship a full OOXML packager — we ship Word-friendly HTML
// with the right namespaces and MIME type.
//
// Limits:
//   - The result is HTML, not OOXML, so advanced Word features
//     (track changes, comments) are not available. Headings, lists,
//     tables, blockquotes and inline styles all import correctly.
//   - For users who need true .docx files we recommend exporting HTML
//     and "Save As → Word Document" from inside Word — same result.

import { buildHtml, type HtmlExportInput } from "./html.ts";

// Wraps an HTML body in the MSO-style head Word recognises. The xmlns
// declarations + ProgId comment are what flips Word into "treat this
// as a Word doc" mode rather than "open as web page".
function wrapForWord(htmlBody: string, projectName: string): string {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(projectName)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 { size: 21cm 29.7cm; margin: 2cm 2cm 2cm 2cm; }
div.WordSection1 { page: WordSection1; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2937; }
h1 { font-size: 22pt; color: #111827; }
h2 { font-size: 16pt; margin-top: 24pt; color: #111827; }
h3 { font-size: 13pt; margin-top: 16pt; color: #1f2937; }
blockquote { border-left: 3pt solid #6366f1; padding-left: 10pt; color: #374151; font-style: italic; margin: 12pt 0; }
.code-pill { display: inline-block; padding: 2pt 6pt; border-radius: 12pt; background: #eef2ff; color: #3730a3; font-size: 9pt; margin-right: 4pt; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1pt solid #e5e7eb; padding: 6pt 8pt; text-align: left; }
th { background: #f3f4f6; }
</style>
</head>
<body>
<div class="WordSection1">
${htmlBody}
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reuses the HTML exporter but strips its <html><head>...</head><body>
// shell so we can wrap it in our Word-flavoured envelope. We rely on
// the fact that buildHtml emits a well-formed document — if it changes,
// adjust the regex below or refactor buildHtml to expose its body.
export function buildDocx(input: HtmlExportInput): Uint8Array {
  const fullHtml = new TextDecoder().decode(buildHtml(input));
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : fullHtml;
  const wrapped = wrapForWord(body, input.project.name);
  return new TextEncoder().encode(wrapped);
}
