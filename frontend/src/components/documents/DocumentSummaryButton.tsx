import { useState } from "react";
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface SummaryResult {
  abstract: string;
  themes: { name: string; description: string }[];
  actors?: { name: string; role: string }[];
  notable_quotes?: { text: string; why_notable: string }[];
  generated_at: string;
  model: string;
}

/**
 * "Resumen IA" button + drawer for the document viewer. The first time
 * it's clicked we call summarize-document, the result is persisted in
 * documents.source_metadata.summary and used as the cache for next
 * opens. The "Regenerar" action forces a refresh.
 */
export function DocumentSummaryButton({
  documentId,
  documentReady,
}: {
  documentId: string;
  documentReady: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [cached, setCached] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const r = await api.summarizeDocument({ documentId, refresh });
      setSummary(r.summary);
      setCached(r.cached);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo generar el resumen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    setOpen(true);
    if (!summary) await load();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleOpen}
        disabled={!documentReady}
        title={
          documentReady
            ? "Resumir el documento con IA (abstract, temas, citas notables)"
            : "Procesa el documento primero"
        }
      >
        <Sparkles className="mr-1 h-4 w-4" />
        Resumen IA
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Resumen del documento
            </SheetTitle>
            <SheetDescription>
              Síntesis generada por Claude. Las citas notables son literales —
              palabras del propio documento.
              {summary ? (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {cached ? "En caché" : "Nuevo"} · modelo {summary.model} ·{" "}
                  {new Date(summary.generated_at).toLocaleString()}
                </span>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          {loading && !summary ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Resumiendo el documento…
            </div>
          ) : summary ? (
            <div className="mt-4 space-y-5">
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Abstract
                </h3>
                <p className="text-sm leading-relaxed">{summary.abstract}</p>
              </section>

              {summary.themes.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Temas dominantes
                  </h3>
                  <ul className="space-y-2">
                    {summary.themes.map((t, i) => (
                      <li key={i} className="rounded-lg border bg-card p-2.5">
                        <div className="text-sm font-medium">{t.name}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {summary.actors && summary.actors.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Actores / roles
                  </h3>
                  <ul className="space-y-1.5">
                    {summary.actors.map((a, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{a.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          — {a.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {summary.notable_quotes && summary.notable_quotes.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Citas notables
                  </h3>
                  <ul className="space-y-2">
                    {summary.notable_quotes.map((q, i) => (
                      <li key={i} className="rounded-lg border bg-amber-50 p-2.5 dark:bg-amber-950/30">
                        <p className="text-sm italic leading-snug">
                          &ldquo;{q.text}&rdquo;
                        </p>
                        <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/80">
                          {q.why_notable}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex justify-end pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => load(true)}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  Regenerar
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Sin resumen aún.
            </p>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
