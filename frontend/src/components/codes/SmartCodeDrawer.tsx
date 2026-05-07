import { useEffect, useMemo, useState } from "react";
import { Wand2, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { Code, QueryNode, Quotation } from "@/types/database";

interface ResolvedQuotation extends Quotation {
  document_title?: string;
}

/**
 * Drawer that resolves a smart code's saved query in real-time and lists
 * the matching quotations. Atlas.ti shows this as a "Smart Code Editor"
 * that re-runs the query every time it's opened — same idea here.
 *
 * Why we don't materialise the membership: smart codes are by design a
 * dynamic view. Pre-computing quotation_codes rows would (a) get stale
 * the second a new quote is created or coded, (b) duplicate state with
 * the saved_query.definition. The cost of running the query on demand
 * is one cheap RPC, so we just do it.
 */
export function SmartCodeDrawer({
  code,
  projectId,
  open,
  onOpenChange,
}: {
  code: Pick<Code, "id" | "name" | "color" | "description" | "smart_query_id">;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResolvedQuotation[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedAt, setResolvedAt] = useState<Date | null>(null);

  const queryId = code.smart_query_id;

  // Fetch the saved query, run it, then fetch the matching quotations.
  // We don't useQuery here because we want a manual "refresh" semantic
  // and tight coupling to the open state of the sheet.
  async function resolve() {
    if (!queryId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: q, error: qErr } = await supabase
        .from("saved_queries")
        .select("definition")
        .eq("id", queryId)
        .single();
      if (qErr) throw qErr;
      const definition = (q as { definition: QueryNode }).definition;

      const exec = await api.executeQuery({ projectId, query: definition });
      setTotal(exec.total);
      setCapped(Boolean(exec.capped));

      if (exec.quotationIds.length === 0) {
        setResults([]);
        setResolvedAt(new Date());
        return;
      }

      // Hydrate quotations in chunks to stay under PostgREST's URL cap.
      const CHUNK = 200;
      const out: ResolvedQuotation[] = [];
      for (let i = 0; i < exec.quotationIds.length; i += CHUNK) {
        const slice = exec.quotationIds.slice(i, i + CHUNK);
        const { data, error: rowsErr } = await supabase
          .from("quotations")
          .select("*, document:documents(title)")
          .in("id", slice);
        if (rowsErr) throw rowsErr;
        for (const row of data ?? []) {
          const r = row as Quotation & { document: { title: string } | null };
          out.push({ ...r, document_title: r.document?.title });
        }
      }
      setResults(out);
      setResolvedAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo resolver el smart code";
      setError(msg);
      toast({ variant: "destructive", title: msg });
    } finally {
      setLoading(false);
    }
  }

  // Auto-resolve when the drawer opens. We don't watch dependencies
  // beyond the open flag so the user controls re-runs explicitly.
  useEffect(() => {
    if (open && queryId) {
      void resolve();
    } else if (!open) {
      // Drop stale results so a fresh open always shows fresh data.
      setResults([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queryId]);

  const sortedResults = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [results]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: code.color }}
            />
            <Wand2 className="h-4 w-4 text-cyan-600" />
            <span className="truncate">{code.name}</span>
          </SheetTitle>
          <SheetDescription>
            Smart code — las citas se resuelven en vivo ejecutando la consulta guardada.
            {code.description ? <span className="mt-1 block text-xs">{code.description}</span> : null}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {loading
              ? "Resolviendo…"
              : error
                ? "Error al resolver"
                : `${total} cita${total === 1 ? "" : "s"} ${capped ? "(resultado limitado)" : "encontrada" + (total === 1 ? "" : "s")}`}
            {resolvedAt && !loading ? (
              <> · resuelto a las {resolvedAt.toLocaleTimeString()}</>
            ) : null}
          </span>
          <Button size="sm" variant="ghost" onClick={resolve} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Recargar
          </Button>
        </div>

        <div className="mt-3 max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Ejecutando la consulta…
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              La consulta no devuelve ninguna cita ahora mismo. Edita el smart code en el
              constructor de consultas para refinar los criterios.
            </div>
          ) : (
            sortedResults.map((q) => (
              <article
                key={q.id}
                className="rounded-lg border bg-card p-3 transition-colors hover:bg-muted/30"
              >
                <p className="line-clamp-3 text-sm italic leading-snug">
                  &ldquo;{q.content}&rdquo;
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {q.document_title ?? "(sin documento)"}
                  </span>
                  <Link
                    to={`/projects/${projectId}/documents/${q.document_id}?quotation=${q.id}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Abrir
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
