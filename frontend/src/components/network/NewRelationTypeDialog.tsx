import { useState, type ReactNode } from "react";
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
import { useCreateRelationType } from "@/hooks/useNetworks";
import { useToast } from "@/hooks/use-toast";
import type { RelationType } from "@/types/database";

const PALETTE = [
  "#EF4444", "#0EA5E9", "#F97316", "#7C3AED", "#10B981",
  "#6366F1", "#EC4899", "#14B8A6", "#F59E0B", "#84CC16",
];

export function NewRelationTypeDialog({
  projectId,
  open: openProp,
  onOpenChange,
  trigger,
  onCreated,
}: {
  projectId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onCreated?: (rt: RelationType) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [isSymmetric, setIsSymmetric] = useState(false);

  const create = useCreateRelationType();
  const { toast } = useToast();

  function reset() {
    setName("");
    setDescription("");
    setColor(PALETTE[0]);
    setIsSymmetric(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const rt = await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        is_symmetric: isSymmetric,
      });
      toast({ title: "Tipo de relación creado", description: rt.name });
      onCreated?.(rt);
      setOpen(false);
      reset();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el tipo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const pending = create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo tipo de relación</DialogTitle>
            <DialogDescription>
              Define un verbo o conector que pueda usarse entre dos entidades de la red
              (códigos, citas, memos, documentos).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="relation-name">Nombre</Label>
            <Input
              id="relation-name"
              placeholder="p. ej., refuerza"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-desc">Descripción (opcional)</Label>
            <Textarea
              id="relation-desc"
              placeholder="¿Qué significa esta relación cuando se aplica entre A y B?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
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
                  className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "white" : "transparent",
                    outline: color === c ? `2px solid ${c}` : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={isSymmetric}
              onChange={(e) => setIsSymmetric(e.target.checked)}
            />
            Relación simétrica (no tiene dirección preferida)
          </label>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear tipo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
