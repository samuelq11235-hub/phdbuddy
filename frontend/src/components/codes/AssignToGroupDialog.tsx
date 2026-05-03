import { useState, type ReactNode } from "react";
import { Loader2, Layers } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  useCodeGroups,
  useAddCodesToGroup,
} from "@/hooks/useCodeGroups";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function AssignToGroupDialog({
  projectId,
  codeIds,
  trigger,
  onAssigned,
}: {
  projectId: string;
  codeIds: string[];
  trigger?: ReactNode;
  onAssigned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const { data: groups, isLoading } = useCodeGroups(projectId);
  const addToGroup = useAddCodesToGroup();
  const { toast } = useToast();

  async function handleAssign() {
    if (!selectedGroupId || codeIds.length === 0) return;
    try {
      await addToGroup.mutateAsync({
        projectId,
        groupId: selectedGroupId,
        codeIds,
      });
      toast({
        title: "Códigos asignados al grupo",
        description: `${codeIds.length} ${codeIds.length === 1 ? "código asignado" : "códigos asignados"}.`,
      });
      onAssigned?.();
      setOpen(false);
      setSelectedGroupId(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la asignación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const empty = !isLoading && (groups?.length ?? 0) === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSelectedGroupId(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Layers className="mr-2 h-3.5 w-3.5" />
            Asignar a grupo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar a grupo</DialogTitle>
          <DialogDescription>
            {codeIds.length === 1
              ? "Selecciona un grupo para este código."
              : `Selecciona un grupo para los ${codeIds.length} códigos seleccionados. Si alguno ya pertenece al grupo, se ignorará.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Grupos del proyecto</Label>
          {empty ? (
            <p className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
              No has creado ningún grupo todavía. Crea uno desde la vista "Por grupo".
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border bg-card p-1">
              {(groups ?? []).map((g) => {
                const active = selectedGroupId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGroupId(g.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "hover:bg-muted/40"
                    )}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">Cancelar</Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleAssign}
            disabled={!selectedGroupId || addToGroup.isPending || codeIds.length === 0}
          >
            {addToGroup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Asignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
