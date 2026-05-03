import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

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
import { colorForName } from "@/hooks/useCodes";
import {
  useCreateCodeGroup,
  useUpdateCodeGroup,
} from "@/hooks/useCodeGroups";
import { useToast } from "@/hooks/use-toast";
import type { CodeGroup } from "@/types/database";

const PALETTE = [
  "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#EC4899", "#14B8A6", "#8B5CF6", "#6366F1", "#F97316",
  "#84CC16", "#06B6D4",
];

export function NewCodeGroupDialog({
  projectId,
  trigger,
  group,
  onSaved,
}: {
  projectId: string;
  trigger?: ReactNode;
  group?: CodeGroup;
  onSaved?: (group: CodeGroup) => void;
}) {
  const editing = !!group;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [color, setColor] = useState(group?.color ?? PALETTE[0]);

  const create = useCreateCodeGroup();
  const update = useUpdateCodeGroup();
  const { toast } = useToast();

  useEffect(() => {
    if (open && group) {
      setName(group.name);
      setDescription(group.description ?? "");
      setColor(group.color);
    }
  }, [open, group]);

  function reset() {
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setColor(group?.color ?? PALETTE[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const effectiveColor = color || colorForName(name);
    try {
      const saved = editing
        ? await update.mutateAsync({
            id: group!.id,
            name: name.trim(),
            description: description.trim() || null,
            color: effectiveColor,
          })
        : await create.mutateAsync({
            projectId,
            name: name.trim(),
            description: description.trim() || undefined,
            color: effectiveColor,
          });
      toast({ title: editing ? "Grupo actualizado" : "Grupo creado" });
      onSaved?.(saved);
      setOpen(false);
      if (!editing) reset();
    } catch (err) {
      toast({
        variant: "destructive",
        title: editing ? "No se pudo actualizar el grupo" : "No se pudo crear el grupo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button>{editing ? "Editar grupo" : "Nuevo grupo"}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar grupo" : "Nuevo grupo de códigos"}</DialogTitle>
            <DialogDescription>
              Los grupos son etiquetas transversales: un código puede pertenecer a varios.
              Útiles para vistas como "Códigos sobre afecto", "Códigos sobre contexto", etc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="group-name">Nombre</Label>
            <Input
              id="group-name"
              placeholder="p. ej., Afecto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-desc">Descripción (opcional)</Label>
            <Textarea
              id="group-desc"
              placeholder="¿Qué une a los códigos de este grupo?"
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
                    borderColor: color === c ? "white" : "transparent",
                    outline: color === c ? `2px solid ${c}` : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Guardar cambios" : "Crear grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
