import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, CheckCheck, X } from "lucide-react";

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

  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [selectedQuoteIdx, setSelectedQuoteIdx] = useState<Set<number>>(new Set());

  // Reset selection when a new suggestion comes in.
  useEffect(() => {
    if (pending) {
      const payload = pending.payload as CodebookSuggestionPayload;
      setSelectedCodes(new Set((payload.codes ?? []).map((c) => c.name)));
      setSelectedQuoteIdx(new Set((payload.quotations ?? []).map((_, i) => i)));
    }
  }, [pending?.id]);

  async function handleRun() {
    try {
      await autoCode.mutateAsync(documentId);
      setOpen(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la auto-codificación",
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

  return (
    <>
      {pending ? (
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sugerencias de auto-codificación con IA</DialogTitle>
            <DialogDescription>
              Revisa lo que propuso Claude. Desmarca lo que no te convenza — solo los elementos
              marcados se añadirán a tu codebook y a tus citas.
            </DialogDescription>
          </DialogHeader>

          {pending ? (
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
            <Button variant="ghost" onClick={handleReject} disabled={!pending || rejectSuggestion.isPending}>
              <X className="mr-2 h-4 w-4" />
              Rechazar todo
            </Button>
            <Button onClick={handleApply} disabled={!pending || applySuggestion.isPending}>
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

  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
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
