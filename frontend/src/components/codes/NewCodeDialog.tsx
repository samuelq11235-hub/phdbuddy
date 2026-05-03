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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCode, colorForName } from "@/hooks/useCodes";
import {
  useCodeGroups,
  useAddCodesToGroup,
} from "@/hooks/useCodeGroups";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#EC4899", "#14B8A6", "#8B5CF6", "#6366F1", "#F97316",
  "#84CC16", "#06B6D4",
];

export function NewCodeDialog({
  projectId,
  parentId,
  trigger,
  defaultName,
  defaultGroupIds,
  onCreated,
}: {
  projectId: string;
  parentId?: string | null;
  trigger?: ReactNode;
  defaultName?: string;
  defaultGroupIds?: string[];
  onCreated?: (codeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(
    new Set(defaultGroupIds ?? [])
  );

  const create = useCreateCode();
  const addToGroup = useAddCodesToGroup();
  const { data: groups } = useCodeGroups(projectId);
  const { toast } = useToast();

  const effectiveColor = color || colorForName(name || "code");

  function reset() {
    setName(defaultName ?? "");
    setDescription("");
    setColor(PALETTE[0]);
    setSelectedGroups(new Set(defaultGroupIds ?? []));
  }

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const code = await create.mutateAsync({
        projectId,
        parentId: parentId ?? null,
        name: name.trim(),
        description: description.trim() || undefined,
        color: effectiveColor,
      });

      const groupIds = Array.from(selectedGroups);
      if (groupIds.length > 0) {
        // Fan out one mutation per group so a partial failure still associates
        // as many groups as possible. Errors are swallowed individually but
        // surfaced as a single toast at the end.
        const results = await Promise.allSettled(
          groupIds.map((groupId) =>
            addToGroup.mutateAsync({
              projectId,
              groupId,
              codeIds: [code.id],
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast({
            variant: "destructive",
            title: "Código creado, pero falló alguna asignación a grupos",
            description: `${failed} de ${groupIds.length} grupos no se pudieron asignar.`,
          });
        }
      }

      toast({ title: "Código creado" });
      onCreated?.(code.id);
      setOpen(false);
      reset();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el código",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button>Nuevo código</Button>}</DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo código</DialogTitle>
            <DialogDescription>
              {parentId ? "Este código se añadirá como subcódigo." : "Añade un código de primer nivel a tu codebook."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="code-name">Nombre</Label>
            <Input
              id="code-name"
              placeholder="p. ej., Agotamiento emocional"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="code-desc">Descripción (opcional)</Label>
            <Textarea
              id="code-desc"
              placeholder="¿Cuándo se aplica este código? ¿Ejemplos?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: effectiveColor === c ? "white" : "transparent",
                    outline: effectiveColor === c ? `2px solid ${c}` : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          {groups && groups.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Grupos (opcional)
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const active = selectedGroups.has(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-transparent text-white"
                          : "bg-card hover:bg-muted/40"
                      )}
                      style={
                        active
                          ? { backgroundColor: g.color }
                          : { borderColor: g.color }
                      }
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: active ? "white" : g.color }}
                      />
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear código
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
