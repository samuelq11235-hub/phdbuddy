import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quote, X, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeBadge } from "@/components/codes/CodeBadge";
import { useCreateQuotation, useToggleCoding, type QuotationWithCodes } from "@/hooks/useQuotations";
import { useCodes, useCreateCode } from "@/hooks/useCodes";
import { useToast } from "@/hooks/use-toast";
import { AddQuotationDialog } from "@/components/quotations/AddQuotationDialog";
import { CodeMargin } from "@/components/documents/CodeMargin";
import { cn } from "@/lib/utils";

interface Props {
  fullText: string;
  quotations: QuotationWithCodes[];
  projectId: string;
  documentId: string;
  highlightQuotationId?: string;
}

interface SelectionState {
  start: number;
  end: number;
  content: string;
}

export function DocumentTextViewer({
  fullText,
  quotations,
  projectId,
  documentId,
  highlightQuotationId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionState | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ top: number; left: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeQuotationId, setActiveQuotationId] = useState<string | null>(null);

  const segments = useMemo(() => buildSegments(fullText, quotations), [fullText, quotations]);
  const createCode = useCreateCode();
  const createQuote = useCreateQuotation();
  const toggle = useToggleCoding();
  const { toast } = useToast();

  // In-vivo coding (Atlas.ti tradition): take the selected text and use
  // it as both the code name and the quotation content in a single
  // action. Triggered by:
  //   - clicking the "in-vivo" button in the floating action bar, or
  //   - pressing the "I" key while a selection is active.
  // Code name is capped at 60 chars and lowercased to match the
  // unique-name index's behaviour.
  const inVivoFromSelection = useCallback(
    async (sel: SelectionState) => {
      const cleaned = sel.content.trim().replace(/\s+/g, " ");
      if (!cleaned) return;
      const codeName = cleaned.slice(0, 60).toLowerCase();
      try {
        const code = await createCode.mutateAsync({
          projectId,
          name: codeName,
          description: `Código in-vivo creado desde una cita.`,
        });
        const quotation = await createQuote.mutateAsync({
          projectId,
          documentId,
          startOffset: sel.start,
          endOffset: sel.end,
          content: cleaned,
        });
        await toggle.mutateAsync({
          quotationId: quotation.id,
          codeId: code.id,
          attach: true,
        });
        toast({ title: `In-vivo "${codeName}" creado` });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "No se pudo crear el código in-vivo",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [createCode, createQuote, toggle, projectId, documentId, toast]
  );

  const handleMouseUp = useCallback(() => {
    if (!textRef.current || !containerRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setPendingSelection(null);
      setSelectionRect(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) {
      setPendingSelection(null);
      setSelectionRect(null);
      return;
    }
    const startOffset = nodeToCharOffset(range.startContainer, range.startOffset);
    const endOffset = nodeToCharOffset(range.endContainer, range.endOffset);
    if (startOffset == null || endOffset == null || startOffset === endOffset) {
      setPendingSelection(null);
      setSelectionRect(null);
      return;
    }
    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    const content = fullText.slice(start, end).trim();
    if (!content) {
      setPendingSelection(null);
      return;
    }
    const trimmedStart = start + (fullText.slice(start, end).indexOf(content) || 0);
    const trimmedEnd = trimmedStart + content.length;
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    setPendingSelection({ start: trimmedStart, end: trimmedEnd, content });
    setSelectionRect({
      top: rect.bottom - containerRect.top + 8,
      left: rect.left - containerRect.left + rect.width / 2,
    });
  }, [fullText]);

  useEffect(() => {
    function onMouseDownGlobal(e: MouseEvent) {
      // If clicking outside the floating button, dismiss it.
      if (!textRef.current) return;
      const target = e.target as Node;
      if (
        textRef.current.contains(target) ||
        (target as HTMLElement).closest?.("[data-floating-action]")
      ) {
        return;
      }
      setPendingSelection(null);
      setSelectionRect(null);
    }
    window.addEventListener("mousedown", onMouseDownGlobal);
    return () => window.removeEventListener("mousedown", onMouseDownGlobal);
  }, []);

  // Keyboard shortcut: "I" while a selection is active fires in-vivo
  // coding. Skipped when the user is typing in an input/textarea so we
  // don't hijack their keystrokes inside the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "i" && e.key !== "I") return;
      if (!pendingSelection) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const sel = pendingSelection;
      setPendingSelection(null);
      setSelectionRect(null);
      window.getSelection()?.removeAllRanges();
      void inVivoFromSelection(sel);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingSelection, inVivoFromSelection]);

  const activeQuotation = useMemo(
    () => quotations.find((q) => q.id === activeQuotationId) ?? null,
    [quotations, activeQuotationId]
  );

  return (
    <div className="relative flex gap-3" ref={containerRef}>
      <div
        ref={textRef}
        className="prose prose-sm min-w-0 max-w-none flex-1 whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-foreground sm:text-[17px] sm:leading-8"
        onMouseUp={handleMouseUp}
      >
        {segments.map((seg, i) => (
          <Segment
            key={i}
            seg={seg}
            highlightId={highlightQuotationId}
            activeId={activeQuotationId}
            onClickQuotation={(id) => setActiveQuotationId(id)}
          />
        ))}
      </div>

      {/* Atlas.ti-style code gutter. Width is dynamic — driven by max stack
          depth — but reserve a minimum so the text doesn't reflow when bars
          appear/disappear during interaction. */}
      <div
        className="relative flex-shrink-0"
        style={{ width: "clamp(48px, 9vw, 120px)" }}
        aria-label="Margen de códigos"
      >
        <CodeMargin
          textRef={textRef}
          containerRef={containerRef}
          quotations={quotations}
          highlightQuotationId={highlightQuotationId}
          activeQuotationId={activeQuotationId}
          onQuotationClick={(id) => setActiveQuotationId(id)}
        />
      </div>

      {pendingSelection && selectionRect && (
        <div
          data-floating-action
          className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background p-1 shadow-lg"
          style={{ top: selectionRect.top, left: selectionRect.left }}
        >
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            <Quote className="mr-1.5 h-3.5 w-3.5" />
            Crear cita
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            title="In-vivo (atajo: I) — crea código y cita con el texto seleccionado"
            onClick={() => {
              const sel = pendingSelection;
              setPendingSelection(null);
              setSelectionRect(null);
              window.getSelection()?.removeAllRanges();
              void inVivoFromSelection(sel);
            }}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            In-vivo
          </Button>
        </div>
      )}

      <AddQuotationDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setPendingSelection(null);
            setSelectionRect(null);
            window.getSelection()?.removeAllRanges();
          }
        }}
        projectId={projectId}
        documentId={documentId}
        selection={pendingSelection}
        fullText={fullText}
      />

      {activeQuotation && (
        <ActiveQuotationPanel
          quotation={activeQuotation}
          onClose={() => setActiveQuotationId(null)}
        />
      )}
    </div>
  );
}

interface SegmentInfo {
  text: string;
  start: number;
  end: number;
  quotations: QuotationWithCodes[];
}

function Segment({
  seg,
  highlightId,
  activeId,
  onClickQuotation,
}: {
  seg: SegmentInfo;
  highlightId?: string;
  activeId: string | null;
  onClickQuotation: (id: string) => void;
}) {
  if (seg.quotations.length === 0) {
    return (
      <span data-offset={seg.start} className="document-segment">
        {seg.text}
      </span>
    );
  }

  const colors = seg.quotations.map((q) => q.codes[0]?.color ?? "#7C3AED");
  const isHighlighted = highlightId && seg.quotations.some((q) => q.id === highlightId);
  const isActive = activeId && seg.quotations.some((q) => q.id === activeId);
  const primary = seg.quotations[seg.quotations.length - 1];

  return (
    <span
      data-offset={seg.start}
      className={cn(
        "document-segment cursor-pointer rounded transition-all hover:brightness-110",
        isHighlighted && "ring-2 ring-primary/60 ring-offset-1",
        isActive && "ring-2 ring-primary ring-offset-1"
      )}
      style={{
        background: blendColors(colors),
        boxShadow: seg.quotations.length > 1 ? "0 0 0 1px rgba(0,0,0,0.05)" : undefined,
      }}
      title={
        seg.quotations
          .map((q) => q.codes.map((c) => c.name).join(", ") || "(sin códigos)")
          .join(" | ")
      }
      onClick={(e) => {
        e.stopPropagation();
        onClickQuotation(primary.id);
      }}
    >
      {seg.text}
    </span>
  );
}

function ActiveQuotationPanel({
  quotation,
  onClose,
}: {
  quotation: QuotationWithCodes;
  onClose: () => void;
}) {
  const { data: codes } = useCodes(quotation.project_id);
  const toggle = useToggleCoding();
  const [adding, setAdding] = useState(false);

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-30 w-full max-w-sm border-l bg-background shadow-2xl sm:bottom-4 sm:right-4 sm:top-auto sm:max-h-[80vh] sm:rounded-xl sm:border">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cita
          </p>
          <p className="text-xs text-muted-foreground">
            caracteres {quotation.start_offset}–{quotation.end_offset}
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4">
        <p className="rounded-md border-l-2 border-primary/40 bg-muted/30 px-3 py-2 text-sm leading-relaxed">
          &ldquo;{quotation.content}&rdquo;
        </p>

        {quotation.comment && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Comentario
            </p>
            <p className="mt-1 text-sm italic text-muted-foreground">{quotation.comment}</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Códigos
            </p>
            <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
              {adding ? "Listo" : "Añadir código"}
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {quotation.codes.length === 0 && (
              <span className="text-xs italic text-muted-foreground">Sin códigos asignados.</span>
            )}
            {quotation.codes.map((c) => (
              <CodeBadge
                key={c.id}
                code={c}
                showAi
                onRemove={() =>
                  toggle.mutate({ quotationId: quotation.id, codeId: c.id, attach: false })
                }
              />
            ))}
          </div>

          {adding && codes && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-md border bg-muted/10 p-1.5">
              {codes
                .filter((c) => !quotation.codes.some((qc) => qc.id === c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      toggle.mutate({ quotationId: quotation.id, codeId: c.id, attach: true })
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span>{c.name}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

// =====================================================
// Helpers
// =====================================================

function buildSegments(text: string, quotations: QuotationWithCodes[]): SegmentInfo[] {
  if (text.length === 0) return [];
  // Skip multimedia quotations (image area / time range): they have no
  // character offsets and don't belong in a text segmentation pass.
  const textQuotations = quotations.filter(
    (q): q is QuotationWithCodes & { start_offset: number; end_offset: number } =>
      q.start_offset !== null && q.end_offset !== null
  );
  if (textQuotations.length === 0) {
    return [{ text, start: 0, end: text.length, quotations: [] }];
  }

  // Collect unique split points from all quotation boundaries.
  const points = new Set<number>([0, text.length]);
  for (const q of textQuotations) {
    points.add(Math.max(0, Math.min(text.length, q.start_offset)));
    points.add(Math.max(0, Math.min(text.length, q.end_offset)));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: SegmentInfo[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;
    const segText = text.slice(start, end);
    const overlapping = textQuotations.filter(
      (q) => q.start_offset < end && q.end_offset > start
    );
    segments.push({ text: segText, start, end, quotations: overlapping });
  }
  return segments;
}

function blendColors(colors: string[]): string {
  if (colors.length === 0) return "transparent";
  if (colors.length === 1) return hexAlpha(colors[0], 0.25);
  // Stack semi-transparent versions to indicate overlap.
  return colors
    .map((c, i) => `linear-gradient(${hexAlpha(c, 0.18 + i * 0.05)}, ${hexAlpha(c, 0.18 + i * 0.05)})`)
    .join(", ");
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function nodeToCharOffset(node: Node, offsetWithinNode: number): number | null {
  // Walk up to find the closest ancestor `<span data-offset>`.
  let cur: Node | null = node;
  let textOffsetInNode = offsetWithinNode;

  // If we landed on an Element (e.g., the document container), pick the
  // appropriate child boundary instead.
  if (cur && cur.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  while (cur && cur.nodeType !== Node.ELEMENT_NODE) {
    cur = cur.parentNode;
  }
  if (!cur) return null;
  let el = cur as HTMLElement;
  while (el && !el.dataset?.offset) {
    el = el.parentElement as HTMLElement;
  }
  if (!el) return null;
  const segStart = parseInt(el.dataset.offset!, 10);
  if (Number.isNaN(segStart)) return null;
  return segStart + textOffsetInNode;
}
