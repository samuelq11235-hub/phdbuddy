// F37 — Reproducibility Report.
//
// Generates and renders a publication-ready snapshot of the project so
// the researcher can attach it to a thesis appendix or journal supp.
// The report covers the codebook, corpus inventory with SHA-256 hash,
// theoretical framework, decision log, and any caveats (e.g. small
// corpus, missing inter-coder agreement).
//
// Two outputs:
//   - Inline preview (everything you need to verify on-screen)
//   - HTML download (offline, single-file, professional layout)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  FileBadge,
  Download,
  ShieldCheck,
  AlertTriangle,
  Hash,
  BookOpen,
  Boxes,
  Tags,
  Activity,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ReproducibilityReportPayload } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

export function ReproducibilityReportPanel({ projectId }: Props) {
  const [enabled, setEnabled] = useState(false);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["reproducibility-report", projectId],
    queryFn: async () => (await api.reproducibilityReport(projectId)).report,
    enabled,
    staleTime: 60_000,
  });

  function downloadHtml() {
    if (!data) return;
    const html = renderReportHtml(data);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(data.project.name)}-reproducibility-${stampDate()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  function downloadJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(data.project.name)}-reproducibility-${stampDate()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <FileBadge className="h-4 w-4 text-violet-500" />
              Reporte de reproducibilidad
            </p>
            <p className="text-[11px] text-muted-foreground">
              Snapshot publicable: codebook congelado, corpus con hash SHA-256,
              decisiones, marco teórico y advertencias.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadJson}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </Button>
                <Button onClick={downloadHtml} size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  HTML
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="gap-1.5"
                >
                  {isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Refrescar
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setEnabled(true);
                  refetch();
                }}
                disabled={isFetching}
                className="gap-1.5"
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileBadge className="h-4 w-4" />
                )}
                Generar reporte
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error instanceof Error ? error.message : "Error desconocido"}
        </div>
      ) : null}

      {isFetching && !data ? <Skeleton className="h-[400px]" /> : null}

      {data ? <ReportPreview report={data} /> : null}
    </div>
  );
}

function ReportPreview({ report }: { report: ReproducibilityReportPayload }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {report.caveats.length > 0 ? (
        <Card className="lg:col-span-2 border-amber-300 bg-amber-50/40 dark:bg-amber-900/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold">Advertencias</p>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {report.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Proyecto</p>
        </div>
        <dl className="mt-2 space-y-1 text-xs">
          <Field label="Nombre" value={report.project.name} />
          <Field
            label="Pregunta"
            value={report.project.research_question ?? "—"}
          />
          <Field
            label="Metodología"
            value={report.project.methodology ?? "—"}
          />
          <Field
            label="Marco teórico"
            value={
              report.framework
                ? `${report.framework.name}${
                    report.framework.citation
                      ? ` · ${report.framework.citation}`
                      : ""
                  }`
                : "(sin marco activo)"
            }
          />
          <Field
            label="Generado"
            value={new Date(report.generatedAt).toLocaleString("es-ES")}
          />
        </dl>
      </Card>

      <Card className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-emerald-500" />
          <p className="text-sm font-semibold">Corpus</p>
        </div>
        <dl className="mt-2 space-y-1 text-xs">
          <Field label="Documentos" value={String(report.corpus.documentCount)} />
          <Field
            label="Palabras"
            value={report.corpus.totalWords.toLocaleString("es-ES")}
          />
          <Field
            label="SHA-256"
            value={
              <code className="break-all font-mono text-[10px]">
                {report.corpus.sha256}
              </code>
            }
          />
        </dl>
      </Card>

      <Card className="px-4 py-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">
            Codebook ({report.codebook.codeCount})
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {report.codebook.rootCount} raíz · {report.codebook.leafCount} hoja(s)
        </p>
        <div className="mt-2 max-h-[260px] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">Código</th>
                <th className="px-2 py-1.5 text-right">Citas</th>
                <th className="px-2 py-1.5 text-left">Padre</th>
              </tr>
            </thead>
            <tbody>
              {report.codebook.codes.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: c.color }}
                      />
                      {c.name}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {c.usage_count}
                  </td>
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {c.parent_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="px-4 py-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-rose-500" />
          <p className="text-sm font-semibold">
            Bitácora de decisiones ({report.decisions.length})
          </p>
        </div>
        <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">Cuándo</th>
                <th className="px-2 py-1.5 text-left">Acción</th>
                <th className="px-2 py-1.5 text-left">Entidad</th>
              </tr>
            </thead>
            <tbody>
              {report.decisions.slice(0, 50).map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-2 py-1 text-[10px] text-muted-foreground">
                    {new Date(d.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="px-2 py-1">{d.action}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {d.entity_type ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {report.attributeSchema.length > 0 ? (
        <Card className="px-4 py-3 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold">
              Atributos ({report.attributeSchema.length})
            </p>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {report.attributeSchema.map((a) => (
              <li key={a.name} className="rounded-md border bg-card px-2 py-1">
                <p className="font-medium">{a.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {a.data_type}
                  {a.options ? ` · ${a.options.length} opciones` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        className={cn(
          "px-4 py-3 lg:col-span-2",
          report.agreement.length > 0
            ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-900/10"
            : ""
        )}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <p className="text-sm font-semibold">
            Acuerdo intercodificadores ({report.agreement.length})
          </p>
        </div>
        {report.agreement.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Aún no se ha registrado ICA persistente. Computa Cohen's κ /
            Krippendorff α en la pestaña Acuerdo y guarda el snapshot para que
            aparezca aquí.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {report.agreement.map((a, i) => (
              <li key={i}>
                {a.coderA} ⇄ {a.coderB} · κ = {a.cohenK.toFixed(3)} ·
                acuerdo {(a.agreement * 100).toFixed(1)}%
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function stampDate() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// =====================================================
// HTML report renderer
// =====================================================
//
// We emit a single self-contained HTML document with print-friendly
// CSS. The structure mirrors the in-app preview so reviewers see the
// same information offline.
function renderReportHtml(r: ReproducibilityReportPayload): string {
  const esc = (s: string | number | null | undefined) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const codebookRows = r.codebook.codes
    .map(
      (c) =>
        `<tr><td><span class="dot" style="background:${esc(
          c.color
        )}"></span>${esc(c.name)}</td><td class="num">${c.usage_count}</td><td class="muted">${esc(c.parent_id ?? "—")}</td><td>${esc(c.description ?? "")}</td></tr>`
    )
    .join("");

  const docRows = r.corpus.documents
    .map(
      (d) =>
        `<tr><td>${esc(d.title)}</td><td class="num">${d.word_count}</td><td class="muted">${esc(
          d.kind ?? "—"
        )}</td><td class="muted">${esc(new Date(d.created_at).toLocaleDateString("es-ES"))}</td></tr>`
    )
    .join("");

  const decisionRows = r.decisions
    .slice(0, 100)
    .map(
      (d) =>
        `<tr><td class="muted">${esc(
          new Date(d.created_at).toLocaleString("es-ES")
        )}</td><td>${esc(d.action)}</td><td class="muted">${esc(d.entity_type ?? "—")}</td></tr>`
    )
    .join("");

  const caveatList = r.caveats
    .map((c) => `<li>${esc(c)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de reproducibilidad — ${esc(r.project.name)}</title>
<style>
* { box-sizing: border-box; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 2rem; color: #1f2937; line-height: 1.55; }
h1 { font-size: 1.6rem; margin: 0 0 0.25rem 0; }
h2 { font-size: 1.1rem; border-top: 1px solid #e5e7eb; padding-top: 1.25rem; margin-top: 2rem; color: #111827; }
.subtitle { color: #6b7280; margin: 0; font-size: 0.85rem; }
.meta { display: grid; grid-template-columns: 180px 1fr; gap: 0.25rem 1rem; font-size: 0.85rem; margin-top: 0.75rem; }
.meta dt { color: #6b7280; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin: 1rem 0; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; background: #fafafa; }
.card .label { font-size: 0.7rem; text-transform: uppercase; color: #6b7280; letter-spacing: 0.04em; }
.card .value { font-size: 1.4rem; font-weight: 600; margin-top: 0.25rem; }
.hash { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.72rem; word-break: break-all; background: #f3f4f6; padding: 0.4rem 0.6rem; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-top: 0.5rem; }
th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
th { font-size: 0.65rem; text-transform: uppercase; color: #6b7280; font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: #6b7280; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.caveats { background: #fffbeb; border: 1px solid #fde68a; padding: 0.75rem 1rem; border-radius: 8px; }
.caveats ul { margin: 0.25rem 0 0 1rem; }
footer { color: #9ca3af; font-size: 0.7rem; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
@media print { body { margin: 0; padding: 1cm; } .card { background: white; } }
</style>
</head>
<body>
<h1>Reporte de reproducibilidad</h1>
<p class="subtitle">${esc(r.project.name)} — Generado ${esc(
    new Date(r.generatedAt).toLocaleString("es-ES")
  )}</p>

${
  r.caveats.length
    ? `<section class="caveats"><strong>Advertencias</strong><ul>${caveatList}</ul></section>`
    : ""
}

<h2>Proyecto</h2>
<dl class="meta">
  <dt>Pregunta de investigación</dt><dd>${esc(r.project.research_question ?? "—")}</dd>
  <dt>Metodología</dt><dd>${esc(r.project.methodology ?? "—")}</dd>
  <dt>Marco teórico</dt><dd>${
    r.framework
      ? `${esc(r.framework.name)}${
          r.framework.citation ? ` · <em>${esc(r.framework.citation)}</em>` : ""
        }`
      : "(sin marco activo)"
  }</dd>
</dl>

<h2>Corpus</h2>
<div class="cards">
  <div class="card"><div class="label">Documentos</div><div class="value">${
    r.corpus.documentCount
  }</div></div>
  <div class="card"><div class="label">Palabras</div><div class="value">${r.corpus.totalWords.toLocaleString(
    "es-ES"
  )}</div></div>
  <div class="card"><div class="label">Códigos</div><div class="value">${r.codebook.codeCount}</div></div>
</div>
<p class="hash"><strong>SHA-256</strong>: ${esc(r.corpus.sha256)}</p>
<table>
  <thead><tr><th>Documento</th><th class="num">Palabras</th><th>Tipo</th><th>Cargado</th></tr></thead>
  <tbody>${docRows}</tbody>
</table>

<h2>Codebook</h2>
<table>
  <thead><tr><th>Código</th><th class="num">Citas</th><th>Padre</th><th>Descripción</th></tr></thead>
  <tbody>${codebookRows}</tbody>
</table>

<h2>Bitácora de decisiones</h2>
<table>
  <thead><tr><th>Cuándo</th><th>Acción</th><th>Entidad</th></tr></thead>
  <tbody>${decisionRows || `<tr><td class="muted" colspan="3">Sin registros.</td></tr>`}</tbody>
</table>

<footer>
  Reporte generado automáticamente por PHDBuddy. Este documento es una
  fotografía determinista del proyecto en el momento de generación; el
  hash SHA-256 permite verificar que el corpus no ha sido modificado
  entre versiones del reporte.
</footer>
</body>
</html>`;
}
