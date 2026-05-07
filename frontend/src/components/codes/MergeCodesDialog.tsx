import { useMemo, useState, type ReactNode } from "react";
import { GitMerge, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCodes, useMergeCodes } from "@/hooks/useCodes";

/**
 * Merge dialog: ATLAS.ti calls this "Merge Codes" — pick a target code,
 * the rest of the selection is collapsed into it. All quotation codings
 * (including ones the current user didn't author) move over and the
 * source codes are deleted. We show a clear warning because the
 * operation is destructive.
 */
export function MergeCodesDialog({
  projectId,
  selectedIds,
  onMerged,
  trigger,
}: {
  projectId: string;
  selectedIds: string[];
  onMerged?: () => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const { data: codes = [] } = useCodes(projectId);
  const merge = useMergeCodes();
  const { toast } = useToast();

  const candidates = useMemo(
    () => codes.filter((c) => selectedIds.includes(c.id)),
    [codes, selectedIds]
  );

  // Default target = the most-used code in the selection. That matches
  // the Atlas.ti default and is almost always what the user wants.
  const defaultTarget = useMemo(() => {
    if (candidates.length === 0) return null;
    return candidates.reduce((acc, c) =>
      c.usage_count > acc.usage_count ? c : acc
    ).id;
  }, [candidates]);

  const effectiveTarget = targetId ?? defaultTarget;
  const sources = candidates.filter((c) => c.id !== effectiveTarget);
  const totalMoves = sources.reduce((acc, c) => acc + c.usage_count, 0);

  async function handleMerge() {
    if (!effectiveTarget || sources.length === 0) return;
    try {
      const res = await merge.mutateAsync({
        projectId,
        targetCodeId: effectiveTarget,
        sourceCodeIds: sources.map((s) => s.id),
      });
      toast({
        title: "Códigos fusionados",
        description: `${res.mergedCount} citas reasignadas, ${res.removedCodes} códigos eliminados.`,
      });
      setOpen(false);
      onMerged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo fusionar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const canRun = candidates.length >= 2 && !!effectiveTarget && sources.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Fusionar códigos
          </DialogTitle>
          <DialogDescription>
            Elige el código que sobrevivirá. Los otros{" "}
            {candidates.length > 1 ? candidates.length - 1 : 0} se
            absorberán en él y se eliminarán. Las citas codificadas con cualquiera de los
            originales pasarán al destino.
          </DialogDescription>
        </DialogHeader>

        {candidates.length < 2 ? (
          <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Selecciona al menos 2 códigos para fusionarlos.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Código destino
            </p>
            <div className="rounded-lg border">
              {candidates.map((c) => {
                const checked = effectiveTarget === c.id;
                return (
                  <label
                    key={c.id}
                    className={
                      "flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/40 " +
                      (checked ? "bg-primary/5" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="merge-target"
                      checked={checked}
                      onChange={() => setTargetId(c.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.usage_count} {c.usage_count === 1 ? "uso" : "usos"}
                    </span>
                  </label>
                );
              })}
            </div>

            {sources.length > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Se moverán hasta <b>{totalMoves}</b> codificaciones desde{" "}
                <b>{sources.length}</b> {sources.length === 1 ? "código" : "códigos"} a{" "}
                <b>{candidates.find((c) => c.id === effectiveTarget)?.name}</b>. Esta
                operación no se puede deshacer.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={handleMerge} disabled={!canRun || merge.isPending}>
            {merge.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="mr-1 h-4 w-4" />
            )}
            Fusionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
