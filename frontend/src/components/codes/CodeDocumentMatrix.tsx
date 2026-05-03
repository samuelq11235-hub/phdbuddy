import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, LayoutGrid, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCodeDocumentMatrix, useCodes } from "@/hooks/useCodes";
import { useCodeGroups, useCodeGroupsIndex } from "@/hooks/useCodeGroups";
import { useDocuments } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";
import type { Code, Document } from "@/types/database";

interface Props {
  projectId: string;
}

/**
 * Atlas.ti-style code × document matrix. Rows are codes, columns are
 * documents, cell shows the count of quotations of that code in that
 * document. Cells are color-tinted with the code's color, opacity scaled
 * by `count / maxCount` so the page reads like a heatmap at a glance.
 */
export function CodeDocumentMatrix({ projectId }: Props) {
  const { data: matrix, isLoading } = useCodeDocumentMatrix(projectId);
  const { data: codes } = useCodes(projectId);
  const { data: documents } = useDocuments(projectId);
  const { data: groups } = useCodeGroups(projectId);
  const groupsIndex = useCodeGroupsIndex(projectId);

  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [docKindFilter, setDocKindFilter] = useState<string>("all");

  const docMap = useMemo(() => new Map((documents ?? []).map((d) => [d.id, d])), [documents]);

  // Filter codes by group + retain only those that participate in the matrix
  // (or have any quotation count). Empty rows are noisy, so we hide codes
  // with zero quotations in any visible document.
  const filteredCodes: Code[] = useMemo(() => {
    if (!codes) return [];
    let list = codes;
    if (groupFilter !== "all" && groupFilter !== "_ungrouped") {
      const allowed = new Set(groupsIndex.codesByGroup.get(groupFilter) ?? []);
      list = list.filter((c) => allowed.has(c.id));
    } else if (groupFilter === "_ungrouped") {
      list = list.filter((c) => !groupsIndex.groupsByCode.has(c.id));
    }
    return list;
  }, [codes, groupFilter, groupsIndex]);

  const filteredDocs: Document[] = useMemo(() => {
    if (!documents) return [];
    if (docKindFilter === "all") return documents;
    return documents.filter((d) => d.kind === docKindFilter);
  }, [documents, docKindFilter]);

  // Build a fast lookup: counts[codeId][documentId] = number.
  const { counts, maxCount } = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    let max = 0;
    for (const row of matrix ?? []) {
      let inner = map.get(row.code_id);
      if (!inner) {
        inner = new Map<string, number>();
        map.set(row.code_id, inner);
      }
      inner.set(row.document_id, row.count);
      if (row.count > max) max = row.count;
    }
    return { counts: map, maxCount: max };
  }, [matrix]);

  // Hide codes that have zero counts within the visible documents — keeps
  // the table tight and readable for projects with many sparse codes.
  const visibleCodes = useMemo(() => {
    const visibleDocIds = new Set(filteredDocs.map((d) => d.id));
    return filteredCodes
      .map((code) => {
        const inner = counts.get(code.id);
        const total = inner
          ? Array.from(inner.entries()).reduce(
              (sum, [docId, count]) => sum + (visibleDocIds.has(docId) ? count : 0),
              0
            )
          : 0;
        return { code, total };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [filteredCodes, filteredDocs, counts]);

  const documentKinds = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents ?? []) set.add(d.kind);
    return Array.from(set).sort();
  }, [documents]);

  const handleExportCSV = () => {
    const rows: string[] = [];
    const header = ["code", ...filteredDocs.map((d) => d.title), "total"];
    rows.push(header.map(csvCell).join(","));
    for (const { code, total } of visibleCodes) {
      const inner = counts.get(code.id);
      const row = [
        code.name,
        ...filteredDocs.map((d) => String(inner?.get(d.id) ?? 0)),
        String(total),
      ];
      rows.push(row.map(csvCell).join(","));
    }
    const blob = new Blob(["\ufeff" + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `code-document-matrix-${projectId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Matriz códigos × documentos</h2>
          <p className="text-sm text-muted-foreground">
            Cada celda muestra cuántas citas de un código aparecen en un documento.
            La intensidad del color refleja la densidad relativa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={visibleCodes.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filtrar por grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los códigos</SelectItem>
            <SelectItem value="_ungrouped">Sin grupo</SelectItem>
            {groups?.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={docKindFilter} onValueChange={setDocKindFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filtrar por tipo de documento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos de documento</SelectItem>
            {documentKinds.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : visibleCodes.length === 0 || filteredDocs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <LayoutGrid className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">La matriz está vacía</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Crea citas y asígnales códigos para ver aquí su distribución por documento. Si ya
            tienes citas, prueba a cambiar los filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 min-w-[200px] bg-muted/40 px-3 py-2 text-left font-medium">
                  Código
                </th>
                {filteredDocs.map((doc) => (
                  <th
                    key={doc.id}
                    className="min-w-[100px] max-w-[160px] border-l px-2 py-2 text-left font-medium"
                    title={doc.title}
                  >
                    <div className="line-clamp-2 leading-tight normal-case">{doc.title}</div>
                  </th>
                ))}
                <th className="min-w-[60px] border-l bg-muted/60 px-3 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleCodes.map(({ code, total }) => {
                const inner = counts.get(code.id);
                return (
                  <tr key={code.id} className="border-b last:border-0">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: code.color }}
                        />
                        <span className="font-medium">{code.name}</span>
                      </div>
                    </td>
                    {filteredDocs.map((doc) => {
                      const value = inner?.get(doc.id) ?? 0;
                      return (
                        <MatrixCell
                          key={doc.id}
                          codeId={code.id}
                          documentId={doc.id}
                          projectId={projectId}
                          color={code.color}
                          value={value}
                          maxValue={maxCount}
                          codeName={code.name}
                          docTitle={docMap.get(doc.id)?.title ?? ""}
                        />
                      );
                    })}
                    <td className="border-l bg-muted/30 px-3 py-2 text-right font-semibold">
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Cargando matriz…
        </div>
      )}
    </div>
  );
}

function MatrixCell({
  codeId,
  documentId,
  projectId,
  color,
  value,
  maxValue,
  codeName,
  docTitle,
}: {
  codeId: string;
  documentId: string;
  projectId: string;
  color: string;
  value: number;
  maxValue: number;
  codeName: string;
  docTitle: string;
}) {
  if (value === 0) {
    return (
      <td className="border-l px-2 py-2 text-center text-xs text-muted-foreground/50">
        ·
      </td>
    );
  }
  const intensity = maxValue > 0 ? value / maxValue : 0;
  const alpha = 0.15 + intensity * 0.55;
  return (
    <td
      className="border-l p-0 text-center"
      style={{ backgroundColor: hexAlpha(color, alpha) }}
    >
      <Link
        to={`/app/p/${projectId}/d/${documentId}?code=${codeId}`}
        title={`${codeName} en ${docTitle}: ${value} ${value === 1 ? "cita" : "citas"}`}
        className={cn(
          "block px-2 py-2 text-sm font-semibold tabular-nums",
          "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        )}
      >
        {value}
      </Link>
    </td>
  );
}

// =====================================================
// Helpers
// =====================================================

function csvCell(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
