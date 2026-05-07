// F35 — Devil's Advocate UI.
//
// A reusable dialog that takes any "claim" (a code description, a memo
// excerpt, a researcher hypothesis) and shows where the corpus disagrees
// with it. Renders the contradictory quotations with a contradiction
// score and a Claude-written synthesis.
import { useState } from "react";
import { Loader2, ShieldAlert, Quote, RefreshCw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  initialClaim?: string;
  source?: string;
  trigger?: React.ReactNode;
}

interface Result {
  counterClaim: string;
  weakSpots: {
    quotationId: string;
    documentTitle: string;
    text: string;
    contradictionScore: number;
    rationale: string;
  }[];
  synthesis: string;
}

export function DevilsAdvocateDialog({
  projectId,
  initialClaim,
  source,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [claim, setClaim] = useState(initialClaim ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(refresh = false) {
    setBusy(true);
    setError(null);
    if (refresh) setResult(null);
    try {
      const r = await api.devilsAdvocate({
        projectId,
        claim,
        source,
        refresh,
      });
      setResult({
        counterClaim: r.counterClaim,
        weakSpots: r.weakSpots,
        synthesis: r.synthesis,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló la crítica");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
            Defensor del diablo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-500" />
            Defensor del diablo
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Busca contraevidencia para esta afirmación en el corpus. Sirve para
            estresar interpretaciones antes de publicarlas.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Escribe la afirmación, hipótesis o interpretación a someter a crítica…"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => run(false)}
              disabled={busy || claim.trim().length < 8}
              className="gap-1.5"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {result ? "Volver a evaluar" : "Buscar contraevidencia"}
            </Button>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="space-y-4">
              <Card className="border-rose-200 bg-rose-50/40 px-4 py-3 dark:bg-rose-900/10">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  Antítesis explorada
                </p>
                <p className="mt-1 text-sm">{result.counterClaim}</p>
              </Card>

              <Card className="bg-card px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Síntesis crítica
                </p>
                <p className="mt-1 text-sm leading-relaxed">
                  {result.synthesis}
                </p>
              </Card>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Citas que tensan la afirmación ({result.weakSpots.length})
                  </p>
                  <button
                    onClick={() => run(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Forzar recálculo (ignora caché)"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reanalizar
                  </button>
                </div>
                {result.weakSpots.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                    No se encontró contraevidencia significativa.
                  </p>
                ) : (
                  result.weakSpots.map((w) => (
                    <Card
                      key={w.quotationId}
                      className={cn(
                        "border-l-4 px-3 py-2",
                        w.contradictionScore >= 0.7
                          ? "border-l-rose-500"
                          : w.contradictionScore >= 0.4
                          ? "border-l-amber-500"
                          : "border-l-zinc-300"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[11px] font-medium text-muted-foreground">
                          <Quote className="mr-1 inline h-3 w-3" />
                          {w.documentTitle}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                            w.contradictionScore >= 0.7
                              ? "bg-rose-100 text-rose-700"
                              : w.contradictionScore >= 0.4
                              ? "bg-amber-100 text-amber-700"
                              : "bg-zinc-100 text-zinc-600"
                          )}
                        >
                          {(w.contradictionScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed">
                        “{w.text}”
                      </p>
                      <p className="mt-1.5 text-[11px] italic text-muted-foreground">
                        {w.rationale}
                      </p>
                    </Card>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
