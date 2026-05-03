import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CodeBadge } from "@/components/codes/CodeBadge";
import { useCodes, useCreateCode, colorForName } from "@/hooks/useCodes";
import { useCreateQuotation } from "@/hooks/useQuotations";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { Code } from "@/types/database";

interface SuggestedNewCode {
  name: string;
  description: string | null;
  rationale?: string;
}

interface ExistingCodeSuggestion {
  id: string;
  name: string;
  description: string | null;
  confidence: number;
  rationale?: string;
}

export function AddQuotationDialog({
  open,
  onOpenChange,
  projectId,
  documentId,
  selection,
  fullText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documentId: string;
  selection: { start: number; end: number; content: string } | null;
  fullText: string;
}) {
  const [selectedCodeIds, setSelectedCodeIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [creatingName, setCreatingName] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiExisting, setAiExisting] = useState<ExistingCodeSuggestion[]>([]);
  const [aiNew, setAiNew] = useState<SuggestedNewCode[]>([]);

  const { data: codes } = useCodes(projectId);
  const createCode = useCreateCode();
  const createQuote = useCreateQuotation();
  const { toast } = useToast();

  const sortedCodes = useMemo(() => {
    if (!codes) return [];
    const q = search.toLowerCase();
    const filtered = q
      ? codes.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q)
        )
      : codes;
    return [...filtered].sort((a, b) => b.usage_count - a.usage_count);
  }, [codes, search]);

  const selectedCodes = useMemo(
    () => (codes ?? []).filter((c) => selectedCodeIds.includes(c.id)),
    [codes, selectedCodeIds]
  );

  // Reset state when reopened
  useEffect(() => {
    if (open) {
      setSelectedCodeIds([]);
      setComment("");
      setSearch("");
      setCreatingName("");
      setAiExisting([]);
      setAiNew([]);
    }
  }, [open]);

  async function fetchAISuggestions() {
    if (!selection) return;
    setAiSuggesting(true);
    try {
      const start = Math.max(0, selection.start - 300);
      const end = Math.min(fullText.length, selection.end + 300);
      const contextBefore = fullText.slice(start, selection.start);
      const contextAfter = fullText.slice(selection.end, end);
      const resp = await api.suggestCodesForQuote({
        projectId,
        documentId,
        text: selection.content,
        contextBefore,
        contextAfter,
      });
      setAiExisting(resp.existing);
      setAiNew(resp.new);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la sugerencia de IA",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAiSuggesting(false);
    }
  }

  function toggleCode(id: string) {
    setSelectedCodeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleCreateInline() {
    const name = (creatingName || search).trim();
    if (!name) return;
    try {
      const code = await createCode.mutateAsync({
        projectId,
        name,
        color: colorForName(name),
      });
      setSelectedCodeIds((prev) => [...prev, code.id]);
      setCreatingName("");
      setSearch("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el código",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleAcceptNewSuggestion(suggestion: SuggestedNewCode) {
    try {
      const code = await createCode.mutateAsync({
        projectId,
        name: suggestion.name,
        description: suggestion.description ?? undefined,
        color: colorForName(suggestion.name),
      });
      setSelectedCodeIds((prev) => [...prev, code.id]);
      setAiNew((prev) => prev.filter((s) => s.name !== suggestion.name));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el código",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleSave() {
    if (!selection) return;
    try {
      await createQuote.mutateAsync({
        projectId,
        documentId,
        startOffset: selection.start,
        endOffset: selection.end,
        content: selection.content,
        comment: comment.trim() || undefined,
        codeIds: selectedCodeIds,
      });
      toast({ title: "Cita guardada" });
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo guardar la cita",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Guardar cita</DialogTitle>
          <DialogDescription>
            Asigna códigos a esta cita y, si lo deseas, añade una nota analítica.
          </DialogDescription>
        </DialogHeader>

        {selection && (
          <div className="rounded-md border-l-4 border-primary bg-muted/30 px-4 py-3 text-sm">
            <p className="line-clamp-4 leading-relaxed">&ldquo;{selection.content}&rdquo;</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {selection.content.length} caracteres · posiciones {selection.start}–{selection.end}
            </p>
          </div>
        )}

        {selectedCodes.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground">Códigos seleccionados</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selectedCodes.map((c) => (
                <CodeBadge
                  key={c.id}
                  code={c}
                  onRemove={() => toggleCode(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Label>Códigos</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={fetchAISuggestions}
            disabled={aiSuggesting}
          >
            {aiSuggesting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3.5 w-3.5" />
            )}
            Sugerir con IA
          </Button>
        </div>

        {(aiExisting.length > 0 || aiNew.length > 0) && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-2">
            <p className="text-xs font-semibold text-primary">Sugerencias de IA</p>
            <div className="flex flex-wrap gap-1.5">
              {aiExisting
                .filter((s) => !selectedCodeIds.includes(s.id))
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleCode(s.id)}
                    className="rounded-full border border-primary/40 bg-background px-2 py-1 text-[11px] font-medium hover:bg-primary/10"
                    title={s.rationale}
                  >
                    + {s.name}{" "}
                    <span className="text-muted-foreground">
                      ({Math.round(s.confidence * 100)}%)
                    </span>
                  </button>
                ))}
              {aiNew.map((s) => (
                <button
                  key={s.name}
                  onClick={() => handleAcceptNewSuggestion(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-background px-2 py-1 text-[11px] font-medium hover:bg-primary/10"
                  title={s.rationale}
                >
                  <Plus className="h-3 w-3" />
                  Nuevo: {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <Input
            placeholder="Buscar códigos o escribir el nombre de un código nuevo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (search.trim() && sortedCodes.length === 0) {
                  setCreatingName(search.trim());
                  void handleCreateInline();
                }
              }
            }}
          />
          {search.trim() &&
            !codes?.some((c) => c.name.toLowerCase() === search.trim().toLowerCase()) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCreatingName(search.trim());
                  void handleCreateInline();
                }}
                disabled={createCode.isPending}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Crear
              </Button>
            )}
        </div>

        <div className="max-h-44 overflow-y-auto rounded-md border bg-muted/10 p-1.5">
          {sortedCodes.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No hay códigos que coincidan. Pulsa Enter o haz clic en Crear para añadir un nuevo código.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {sortedCodes.map((c) => (
                <li key={c.id}>
                  <CodeRow
                    code={c}
                    selected={selectedCodeIds.includes(c.id)}
                    onToggle={() => toggleCode(c.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quote-comment">Comentario (opcional)</Label>
          <Textarea
            id="quote-comment"
            placeholder="¿Por qué este fragmento es analíticamente importante?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selection || createQuote.isPending}>
            {createQuote.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Guardar cita
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeRow({
  code,
  selected,
  onToggle,
}: {
  code: Code;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        selected ? "bg-primary/10 text-primary" : "hover:bg-muted/40"
      }`}
    >
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: code.color }} />
      <span className="flex-1 truncate">{code.name}</span>
      {code.usage_count > 0 && (
        <span className="text-xs text-muted-foreground">{code.usage_count}</span>
      )}
      <input
        type="checkbox"
        checked={selected}
        readOnly
        className="h-4 w-4 accent-primary"
        tabIndex={-1}
      />
    </button>
  );
}
