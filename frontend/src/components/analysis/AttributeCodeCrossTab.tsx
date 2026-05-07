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
                {topCodes.map((c) => (
                  <th
                    key={c.id}
                    className="whitespace-nowrap px-2 py-2 text-right font-medium"
                    style={{ minWidth: 80 }}
                    title={c.name}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="truncate">{c.name}</span>
                    </div>
                  </th>
                ))}
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
