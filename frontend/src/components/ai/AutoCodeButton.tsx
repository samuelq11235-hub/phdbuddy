import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, CheckCheck, X, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAutoCode, useApplySuggestion, useDocumentSuggestions, useRejectSuggestion } from "@/hooks/useAISuggestions";
import { useToast } from "@/hooks/use-toast";
import type { AISuggestion, CodebookSuggestionPayload } from "@/types/database";

export function AutoCodeButton({
  documentId,
  documentReady,
}: {
  documentId: string;
  documentReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const autoCode = useAutoCode();
  const applySuggestion = useApplySuggestion();
  const rejectSuggestion = useRejectSuggestion();
  const { data: suggestions } = useDocumentSuggestions(documentId);
  const { toast } = useToast();

  const pending = useMemo(
    () => suggestions?.find((s) => s.status === "pending") ?? null,
    [suggestions]
  );

  // Three flavors of "pending":
  //   - processing: background worker is still calling Claude; show a
  //     spinner button with progress, no review dialog yet.
  //   - error: background worker crashed (rate limit, schema, ...); show
  //     a destructive button that re-runs on click.
  //   - ready: payload has codes/quotations; show the review CTA.
  const isProcessing = pending?.payload?.processing === true;
  const hasError =
    !!pending?.payload?.error && pending.payload.processing !== true;
  const isReady = !!pending && !isProcessing && !hasError;

  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [selectedQuoteIdx, setSelectedQuoteIdx] = useState<Set<number>>(new Set());

  // Reset selection when a new suggestion comes in (only once it's ready).
  useEffect(() => {
    if (isReady && pending) {
      const payload = pending.payload as CodebookSuggestionPayload;
      setSelectedCodes(new Set((payload.codes ?? []).map((c) => c.name)));
      setSelectedQuoteIdx(new Set((payload.quotations ?? []).map((_, i) => i)));
    }
  }, [isReady, pending?.id]);

  // Auto-open the review dialog the moment a job we just kicked off
  // finishes — but don't do it on subsequent reloads where the user
  // already saw the suggestion (they'll click the "Revisar" button).
  const watchingJobId = useRef<string | null>(null);
  useEffect(() => {
    if (isProcessing && pending) watchingJobId.current = pending.id;
  }, [isProcessing, pending?.id]);
  useEffect(() => {
    if (
      isReady &&
      pending &&
      watchingJobId.current === pending.id
    ) {
      setOpen(true);
      watchingJobId.current = null;
      toast({
        title: "Auto-codificación lista",
        description: `${pending.payload.codes?.length ?? 0} códigos · ${
          pending.payload.quotations?.length ?? 0
        } citas para revisar.`,
      });
    }
  }, [isReady, pending?.id]);

  // Same idea but for failures: bubble up the error as a toast the
  // moment the background job marks itself with payload.error.
  useEffect(() => {
    if (
      hasError &&
      pending &&
      watchingJobId.current === pending.id
    ) {
      watchingJobId.current = null;
      const message = pending.payload.error ?? "La auto-codificación falló";
      const isCreditError =
        /credit balance/i.test(message) ||
        /insufficient.*credit/i.test(message) ||
        /Plans.*Billing/i.test(message);
      const isRateLimit =
        !isCreditError &&
        (pending.payload.rate_limited === true ||
          /rate.?limit/i.test(message) ||
          /tokens? per minute/i.test(message));
      toast({
        variant: "destructive",
        title: isCreditError
          ? "Sin saldo en Anthropic"
          : isRateLimit
            ? "Anthropic está limitando tu uso"
            : "Falló la auto-codificación",
        description: isCreditError
          ? "Tu cuenta de Anthropic se ha quedado sin créditos. Añade saldo en console.anthropic.com → Plans & Billing y reintenta."
          : isRateLimit
            ? "Tu organización alcanzó el límite de tokens por minuto. Espera 60s y reintenta."
            : message,
      });
    }
  }, [hasError, pending?.id]);

  async function handleRun() {
    try {
      // The edge function now responds in <1s with the placeholder row
      // and runs the heavy work in the background. We don't open the
      // dialog until the job actually has codes/quotes to review.
      await autoCode.mutateAsync(documentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      const isRateLimit =
        /rate.?limit/i.test(message) ||
        /429/.test(message) ||
        /tokens? per minute/i.test(message);
      toast({
        variant: "destructive",
        title: isRateLimit
          ? "Anthropic está limitando tu uso"
          : "Falló la auto-codificación",
        description: isRateLimit
          ? "Tu organización alcanzó el límite de tokens por minuto. Espera 60s y reintenta. Si el documento es muy largo, divídelo en partes."
          : message,
      });
    }
  }

  async function handleRetry() {
    if (!pending) return;
    try {
      // Mark the failed row as rejected before kicking off a new job so
      // the UI doesn't show two pending rows side by side.
      await rejectSuggestion.mutateAsync(pending.id);
      await autoCode.mutateAsync(documentId);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo reintentar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleApply() {
    if (!pending) return;
    try {
      const result = await applySuggestion.mutateAsync({
        suggestionId: pending.id,
        acceptedCodeNames: [...selectedCodes],
        acceptedQuotationIndices: [...selectedQuoteIdx],
      });
      toast({
        title: "Aplicado",
        description: `${result.insertedCodes} códigos, ${result.insertedQuotations} citas.`,
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la aplicación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleReject() {
    if (!pending) return;
    try {
      await rejectSuggestion.mutateAsync(pending.id);
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el rechazo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const progressLabel = useMemo(() => {
    if (!isProcessing || !pending) return null;
    const p = pending.payload?.progress;
    if (!p) return "Preparando…";
    if (p.stage === "queued") return "En cola…";
    if (p.stage === "codebook") return "Generando codebook…";
    if (p.stage === "quotations") {
      if (p.waiting_ms && p.waiting_ms > 1500) {
        return `Esperando rate limit de Anthropic (${Math.round(p.waiting_ms / 1000)}s)…`;
      }
      if (p.chunks_total > 0) {
        return `Extrayendo citas (${p.chunks_done}/${p.chunks_total})…`;
      }
      return "Extrayendo citas…";
    }
    return "Procesando…";
  }, [isProcessing, pending]);

  return (
    <>
      {isProcessing ? (
        <Button
          variant="outline"
          disabled
          className="border-primary/40 bg-primary/5 text-primary"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {progressLabel ?? "Procesando…"}
        </Button>
      ) : hasError ? (
        <ErrorBanner
          error={pending?.payload.error ?? "Error desconocido"}
          onRetry={handleRetry}
          retrying={autoCode.isPending || rejectSuggestion.isPending}
        />
      ) : isReady ? (
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Revisar sugerencias de IA
        </Button>
      ) : (
        <Button onClick={handleRun} disabled={autoCode.isPending || !documentReady}>
          {autoCode.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Auto-codificar con IA
        </Button>
      )}

      <Dialog open={open && isReady} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sugerencias de auto-codificación con IA</DialogTitle>
            <DialogDescription>
              Revisa lo que propuso Claude. Desmarca lo que no te convenza — solo los elementos
              marcados se añadirán a tu codebook y a tus citas.
            </DialogDescription>
          </DialogHeader>

          {isReady && pending ? (
            <ReviewPanel
              suggestion={pending as AISuggestion<CodebookSuggestionPayload>}
              selectedCodes={selectedCodes}
              setSelectedCodes={setSelectedCodes}
              selectedQuoteIdx={selectedQuoteIdx}
              setSelectedQuoteIdx={setSelectedQuoteIdx}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No hay sugerencias pendientes.</p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={handleReject} disabled={!isReady || rejectSuggestion.isPending}>
              <X className="mr-2 h-4 w-4" />
              Rechazar todo
            </Button>
            <Button onClick={handleApply} disabled={!isReady || applySuggestion.isPending}>
              {applySuggestion.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-4 w-4" />
              )}
              Aplicar seleccionado ({selectedCodes.size} códigos / {selectedQuoteIdx.size} citas)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ErrorBanner({
  error,
  onRetry,
  retrying,
}: {
  error: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  // Categorise the error so the message is actionable instead of dumping
  // a raw Anthropic JSON blob on the user.
  const isCreditError =
    /credit balance/i.test(error) ||
    /insufficient.*credit/i.test(error) ||
    /Plans.*Billing/i.test(error);
  const isRateLimit =
    !isCreditError &&
    (/rate.?limit/i.test(error) || /tokens? per minute/i.test(error));

  const title = isCreditError
    ? "Sin saldo en Anthropic"
    : isRateLimit
      ? "Anthropic limitó el uso"
      : "Falló la auto-codificación";
  const description = isCreditError ? (
    <>
      Tu cuenta de Anthropic se ha quedado sin créditos. Añade saldo en{" "}
      <a
        href="https://console.anthropic.com/settings/billing"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        console.anthropic.com → Plans &amp; Billing
      </a>{" "}
      y vuelve a intentarlo.
    </>
  ) : isRateLimit ? (
    "Espera ~60 segundos a que Anthropic libere el rate limit y reintenta."
  ) : (
    error.length > 200 ? error.slice(0, 200) + "…" : error
  );

  return (
    <div className="flex max-w-md items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-xs opacity-90">{description}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={retrying || isCreditError}
        className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={isCreditError ? "Añade saldo antes de reintentar" : undefined}
      >
        {retrying ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
        )}
        Reintentar
      </Button>
    </div>
  );
}

function ReviewPanel({
  suggestion,
  selectedCodes,
  setSelectedCodes,
  selectedQuoteIdx,
  setSelectedQuoteIdx,
}: {
  suggestion: AISuggestion<CodebookSuggestionPayload>;
  selectedCodes: Set<string>;
  setSelectedCodes: (s: Set<string>) => void;
  selectedQuoteIdx: Set<number>;
  setSelectedQuoteIdx: (s: Set<number>) => void;
}) {
  const payload = suggestion.payload;

  function toggleCode(name: string) {
    const next = new Set(selectedCodes);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedCodes(next);
  }
  function toggleQuote(i: number) {
    const next = new Set(selectedQuoteIdx);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelectedQuoteIdx(next);
  }

  const rateLimitWarning =
    payload.codebook_fallback || (payload.rate_limited_chunks ?? 0) > 0;

  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
      {rateLimitWarning && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Resultado parcial.</strong>{" "}
          {payload.codebook_fallback
            ? "Se reutilizó el codebook existente del proyecto porque la generación nueva fue limitada por Anthropic. "
            : null}
          {(payload.rate_limited_chunks ?? 0) > 0
            ? `${payload.rate_limited_chunks} fragmento(s) del documento no se pudieron procesar por límite de tokens. `
            : null}
          Espera ~60 segundos y vuelve a ejecutar la auto-codificación para completar la cobertura.
        </div>
      )}
      {payload.summary && (
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm italic text-muted-foreground">
          {payload.summary}
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Códigos propuestos ({payload.codes?.length ?? 0})
        </h4>
        <div className="space-y-1.5">
          {(payload.codes ?? []).map((c) => (
            <label
              key={c.name}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2 hover:bg-muted/30"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={selectedCodes.has(c.name)}
                onChange={() => toggleCode(c.name)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: c.color ?? "#7C3AED" }}
                  />
                  <span className="font-medium">{c.name}</span>
                </div>
                {c.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Citas propuestas ({payload.quotations?.length ?? 0})
        </h4>
        <div className="space-y-2">
          {(payload.quotations ?? []).map((q, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-3 hover:bg-muted/30"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={selectedQuoteIdx.has(i)}
                onChange={() => toggleQuote(i)}
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-sm leading-relaxed">&ldquo;{q.content}&rdquo;</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {q.code_names.map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                    >
                      {name}
                    </span>
                  ))}
                  {q.confidence != null && (
                    <span className="text-muted-foreground">
                      confianza {Math.round(q.confidence * 100)}%
                    </span>
                  )}
                </div>
                {q.rationale && (
                  <p className="mt-1 text-xs italic text-muted-foreground">{q.rationale}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {payload.chunks && payload.chunks > 1
          ? `Documento procesado en ${payload.chunks} fragmentos (${payload.source_chars?.toLocaleString()} caracteres en total).`
          : `Documento analizado completo (${payload.source_chars?.toLocaleString()} caracteres).`}
        {payload.truncated && payload.full_chars && (
          <>
            {" "}Nota: el documento tiene {payload.full_chars.toLocaleString()} caracteres y solo
            se procesaron los primeros {payload.source_chars?.toLocaleString()} (límite duro de
            seguridad). Si necesitas cobertura completa, divide el documento en partes.
          </>
        )}
      </p>
    </div>
  );
}
