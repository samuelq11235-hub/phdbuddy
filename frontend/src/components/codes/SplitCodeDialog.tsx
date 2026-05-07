import { useMemo, useState } from "react";
import { Loader2, Scissors, CheckSquare, Square } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuotations } from "@/hooks/useQuotations";
import { useSplitCode } from "@/hooks/useCodes";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  sourceCodeId: string;
  sourceCodeName: string;
  trigger: React.ReactNode;
  onSplit?: (newCodeId: string) => void;
}

/**
 * Splits an existing code in two. The user picks a subset of the source
 * code's quotations and gives a name to the new code; the RPC moves
 * exactly those `quotation_codes` rows over and leaves the rest behind.
 *
 * The selection UI is intentionally minimal — a checkbox list with the
 * quotation preview. We don't paginate because the typical use-case is a
 * code with at most a few dozen quotations; for the rare gigantic code
 * the textarea search filters quickly.
 */
export function SplitCodeDialog({
  projectId,
  sourceCodeId,
  sourceCodeName,
  trigger,
  onSplit,
}: Props) {
  const [open, setOpen] = useState(false);
  const { data: quotations, isLoading } = useQuotations(
    open ? projectId : undefined,
    { codeId: open ? sourceCodeId : undefined }
  );
  const split = useSplitCode();
  const { toast } = useToast();

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const filteredQuotations = useMemo(() => {
    if (!quotations) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return quotations;
    return quotations.filter(
      (q) =>
        q.content.toLowerCase().includes(f) ||
        (q.document_title?.toLowerCase().includes(f) ?? false)
    );
  }, [quotations, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filteredQuotations.map((q) => q.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  function reset() {
    setNewName("");
    setNewDescription("");
    setSelected(new Set());
    setFilter("");
  }

  async function handleSubmit() {
    if (!newName.trim()) {
      toast({ variant: "destructive", title: "Nombre requerido" });
      return;
    }
    if (selected.size === 0) {
      toast({ variant: "destructive", title: "Selecciona al menos una cita" });
      return;
    }
    try {
      const result = await split.mutateAsync({
        projectId,
        sourceCodeId,
        quotationIds: Array.from(selected),
        newName: newName.trim(),
        newDescription: newDescription.trim() || undefined,
      });
      toast({
        title: "Código dividido",
        description: `${result.movedCount} citas movidas a "${newName.trim()}".`,
      });
      if (result.newCodeId) onSplit?.(result.newCodeId);
      reset();
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo dividir",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const totalCount = quotations?.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" /> Dividir código
          </DialogTitle>
          <DialogDescription>
            Selecciona las citas de <span className="font-medium">{sourceCodeName}</span>{" "}
            que pasarán a un código nuevo. El resto permanecen en el código original.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="split-name">Nombre del nuevo código</Label>
            <Input
              id="split-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`${sourceCodeName} (subgrupo)`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="split-desc">Descripción (opcional)</Label>
            <Input
              id="split-desc"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Qué distingue a este subgrupo"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar citas…"
            className="h-8 max-w-xs"
          />
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {selected.size}/{filteredQuotations.length} seleccionadas
          </span>
          <Button type="button" variant="outline" size="sm" onClick={selectAll}>
            Todas
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={selectNone}>
            Ninguna
          </Button>
        </div>

        <div className="-mr-3 max-h-[40vh] overflow-y-auto pr-3">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredQuotations.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {totalCount === 0
                ? "Este código no tiene citas asociadas."
                : "Sin coincidencias para el filtro."}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredQuotations.map((q) => {
                const checked = selected.has(q.id);
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => toggle(q.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong",
                        checked && "border-primary/40 bg-primary/5"
                      )}
                    >
                      {checked ? (
                        <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm leading-snug">
                          {q.content}
                        </p>
                        {q.document_title ? (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {q.document_title}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={split.isPending || selected.size === 0 || !newName.trim()}
          >
            {split.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Scissors className="mr-2 h-4 w-4" />
            )}
            Dividir ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

