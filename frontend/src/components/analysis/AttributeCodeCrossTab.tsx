import { useMemo, useState } from "react";
import { Loader2, Table2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useDocuments } from "@/hooks/useDocuments";
import { useDocumentAttributeSchema } from "@/hooks/useDocumentGroups";
import { useCodes } from "@/hooks/useCodes";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";

/**
 * Cross-tabulation panel: rows = values of a chosen document attribute
 * (e.g. "Genre = Female / Male"), columns = codes (top N by usage),
 * cells = how many quotations in documents with that attribute value
 * carry that code.
 *
 * This is the standard "compare codings across subgroups" view in
 * ATLAS.ti — letting you spot whether, say, the "stress" code is more
 * common in interviews from female participants than male.
 */
export function AttributeCodeCrossTab({ projectId }: { projectId: string }) {
  const { data: schema = [] } = useDocumentAttributeSchema(projectId);
  const { data: documents = [] } = useDocuments(projectId);
  const { data: codes = [] } = useCodes(projectId);

  const [attributeName, setAttributeName] = useState<string | null>(null);
  const [topN, setTopN] = useState<number>(15);

  // Auto-pick the first attribute if none selected.
  const effectiveAttr = attributeName ?? schema[0]?.name ?? null;

  // Codes to show as columns: top-N most-used.
  const topCodes = useMemo(
    () => [...codes].sort((a, b) => b.usage_count - a.usage_count).slice(0, topN),
    [codes, topN]
  );
  const codeIdSet = useMemo(() => new Set(topCodes.map((c) => c.id)), [topCodes]);

  // Pull all (code_id, document_id) pairs at once. We do this via a
  // join through quotations because quotation_codes doesn't carry
  // document_id directly. Stays well under PostgREST's URL caps for
  // any reasonable project size.
  const codingsQuery = useQuery({
    queryKey: ["xtab-codings", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("quotation_codes")
        .select("code_id, quotation:quotations(document_id, project_id)")
        .limit(50_000);
      if (error) throw error;
      type Row = {
        code_id: string;
        quotation: { document_id: string; project_id: string } | { document_id: string; project_id: string }[] | null;
      };
      return (data ?? []).flatMap((row) => {
        const r = row as Row;
        const q = Array.isArray(r.quotation) ? r.quotation[0] : r.quotation;
        if (!q || q.project_id !== projectId) return [];
        return [{ code_id: r.code_id, document_id: q.document_id }];
      });
    },
    enabled: !!projectId,
  });

  // Build attribute-value → document-set map from documents.source_metadata.
  const valueToDocs = useMemo(() => {
    const out = new Map<string, Set<string>>();
    if (!effectiveAttr) return out;
    for (const doc of documents) {
      const meta = (doc.source_metadata ?? {}) as Record<string, unknown>;
      const raw = meta[effectiveAttr];
      const v = raw == null || raw === "" ? "(sin valor)" : String(raw);
      let bucket = out.get(v);
      if (!bucket) {
        bucket = new Set<string>();
        out.set(v, bucket);
      }
      bucket.add(doc.id);
    }
    return out;
  }, [documents, effectiveAttr]);

  // Index codings by document_id for fast lookups.
  const codingsByDoc = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const c of codingsQuery.data ?? []) {
      if (!codeIdSet.has(c.code_id)) continue;
      const arr = out.get(c.document_id) ?? [];
      arr.push(c.code_id);
      out.set(c.document_id, arr);
    }
    return out;
  }, [codingsQuery.data, codeIdSet]);

  // Build the matrix: cell = sum over docs in (value bucket) of count
  // of codings for (code) in those docs.
  const matrix = useMemo(() => {
    const rows: { value: string; total: number; perCode: Map<string, number> }[] = [];
    for (const [value, docSet] of valueToDocs) {
      const perCode = new Map<string, number>();
      let total = 0;
      for (const docId of docSet) {
        const codings = codingsByDoc.get(docId) ?? [];
        for (const codeId of codings) {
          perCode.set(codeId, (perCode.get(codeId) ?? 0) + 1);
          total++;
        }
      }
      rows.push({ value, total, perCode });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [valueToDocs, codingsByDoc]);

  // F32 — mixed-methods bridge: per-column statistics.
  //
  // For every code we test the null hypothesis that its distribution
  // across the attribute buckets is independent of the attribute. We
  // approximate via Pearson's χ² on a `[code present | code absent]`
  // contingency table per row, then look up a critical value. We also
  // return the dominant bucket so the UI can label "Strongest in: X".
  //
  // p-value is approximated from the χ² statistic with df = rows-1
  // using a Wilson-Hilferty cubic-root approximation. It's accurate
  // to ~0.005 around the standard significance thresholds.
  const stats = useMemo(() => {
    const result = new Map<
      string,
      { chi2: number; df: number; pApprox: number; dominant: string | null }
    >();
    if (matrix.length < 2) return result;
    const grand = matrix.reduce((a, b) => a + b.total, 0);
    if (grand === 0) return result;
    for (const code of topCodes) {
      const codeTotal = matrix.reduce(
        (a, r) => a + (r.perCode.get(code.id) ?? 0),
        0
      );
      if (codeTotal === 0) continue;
      let chi2 = 0;
      let dominantValue: string | null = null;
      let dominantRatio = 0;
      for (const row of matrix) {
        const rowTotal = row.total;
        if (rowTotal === 0) continue;
        const observedCode = row.perCode.get(code.id) ?? 0;
        const observedNotCode = rowTotal - observedCode;
        const expectedCode = (rowTotal * codeTotal) / grand;
        const expectedNotCode = rowTotal - expectedCode;
        if (expectedCode > 0)
          chi2 += Math.pow(observedCode - expectedCode, 2) / expectedCode;
        if (expectedNotCode > 0)
          chi2 +=
            Math.pow(observedNotCode - expectedNotCode, 2) / expectedNotCode;
        const ratio = observedCode / Math.max(rowTotal, 1);
        if (ratio > dominantRatio) {
          dominantRatio = ratio;
          dominantValue = row.value;
        }
      }
      const df = matrix.length - 1;
      result.set(code.id, {
        chi2,
        df,
        pApprox: chi2PValueApprox(chi2, df),
        dominant: dominantValue,
      });
    }
    return result;
  }, [matrix, topCodes]);

  if (schema.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
        <Table2 className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">Sin atributos definidos</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Define atributos de documento (edad, género, año, etc.) en la pestaña{" "}
          <span className="font-medium">Grupos</span> para poder cruzar codificaciones.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Atributo (filas)</label>
          <Select
            value={effectiveAttr ?? undefined}
            onValueChange={(v) => setAttributeName(v)}
          >
            <SelectTrigger className="mt-1 w-[220px]">
              <SelectValue placeholder="Atributo" />
            </SelectTrigger>
            <SelectContent>
              {schema.map((s) => (
                <SelectItem key={s.id} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Códigos (columnas)</label>
          <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v))}>
            <SelectTrigger className="mt-1 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="15">Top 15</SelectItem>
              <SelectItem value="25">Top 25</SelectItem>
              <SelectItem value="40">Top 40</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCrossTabCsv(matrix, topCodes)}
          disabled={matrix.length === 0}
        >
          Exportar CSV
        </Button>
      </div>

      {codingsQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando codificaciones…
        </div>
      ) : matrix.length === 0 || topCodes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aún no hay codificaciones cruzables con este atributo.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">
                  {effectiveAttr}
                </th>
                <th className="px-3 py-2 text-right font-medium">Σ</th>
                {topCodes.map((c) => {
                  const s = stats.get(c.id);
                  const sig = s ? significanceLabel(s.pApprox) : null;
                  return (
                    <th
                      key={c.id}
                      className="whitespace-nowrap px-2 py-2 text-right font-medium"
                      style={{ minWidth: 80 }}
                      title={
                        s
                          ? `${c.name}\nχ²(${s.df}) = ${s.chi2.toFixed(2)}; p ≈ ${s.pApprox.toFixed(3)}${
                              s.dominant ? `; pico en: ${s.dominant}` : ""
                            }`
                          : c.name
                      }
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate">{c.name}</span>
                        {sig ? (
                          <span
                            className={`ml-1 rounded px-1 text-[9px] font-bold ${sig.cls}`}
                            title={sig.label}
                          >
                            {sig.mark}
                          </span>
                        ) : null}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.value} className="border-t">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                    {row.value}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {row.total}
                  </td>
                  {topCodes.map((c) => {
                    const v = row.perCode.get(c.id) ?? 0;
                    return (
                      <td
                        key={c.id}
                        className="px-2 py-2 text-right tabular-nums"
                        style={{
                          backgroundColor:
                            v > 0
                              ? `${c.color}${heatAlpha(v, row.total)}`
                              : undefined,
                        }}
                      >
                        {v || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Map a count to an alpha-channel hex string ("00".."ff") for a heatmap
// effect within each row. We normalise per-row so the colour intensity
// reflects relative prominence within that attribute value, not absolute.
function heatAlpha(value: number, rowTotal: number): string {
  if (rowTotal <= 0) return "00";
  const ratio = Math.min(1, value / rowTotal);
  const a = Math.round(20 + ratio * 130);
  return a.toString(16).padStart(2, "0");
}

function significanceLabel(p: number): { mark: string; label: string; cls: string } | null {
  if (p < 0.001)
    return {
      mark: "***",
      label: `χ² test p < 0.001`,
      cls: "bg-emerald-100 text-emerald-700",
    };
  if (p < 0.01)
    return {
      mark: "**",
      label: `χ² test p < 0.01`,
      cls: "bg-emerald-100 text-emerald-700",
    };
  if (p < 0.05)
    return {
      mark: "*",
      label: `χ² test p < 0.05`,
      cls: "bg-amber-100 text-amber-700",
    };
  return null;
}

// Wilson-Hilferty cubic-root approximation: maps χ² to p-value via a
// transformation that lands on a standard normal. Accurate to ~0.005
// around the canonical significance thresholds (df ≥ 1, χ² ≥ 0.5).
// We avoid pulling a stats library for what amounts to a heat-map
// readability cue, not a rigorous test.
function chi2PValueApprox(chi2: number, df: number): number {
  if (chi2 <= 0 || df <= 0) return 1;
  const k = df;
  const z = (Math.cbrt(chi2 / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  // Two-sided isn't meaningful for χ² — use upper tail.
  return 1 - normalCdf(z);
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 — max error ~1.5e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t *
            (1.781477937 +
              t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function exportCrossTabCsv(
  matrix: { value: string; total: number; perCode: Map<string, number> }[],
  codes: { id: string; name: string }[]
) {
  const header = ["value", "total", ...codes.map((c) => c.name)];
  const lines = [header.join(",")];
  for (const row of matrix) {
    const cells = [
      `"${row.value.replace(/"/g, '""')}"`,
      String(row.total),
      ...codes.map((c) => String(row.perCode.get(c.id) ?? 0)),
    ];
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crosstab-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
