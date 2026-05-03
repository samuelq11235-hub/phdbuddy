import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteLink, useUpdateLink } from "@/hooks/useNetworks";
import { useToast } from "@/hooks/use-toast";
import type { Link, RelationType } from "@/types/database";

export function EdgeEditDialog({
  link,
  relationTypes,
  onClose,
  onCreateRelationType,
}: {
  link: Link | null;
  relationTypes: RelationType[];
  onClose: () => void;
  onCreateRelationType: () => void;
}) {
  const update = useUpdateLink();
  const del = useDeleteLink();
  const { toast } = useToast();

  const [relationTypeId, setRelationTypeId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (link) {
      setRelationTypeId(link.relation_type_id);
      setComment(link.comment ?? "");
    }
  }, [link]);

  if (!link) return null;

  async function handleSave() {
    if (!link) return;
    try {
      await update.mutateAsync({
        id: link.id,
        relation_type_id: relationTypeId,
        comment: comment.trim() ? comment.trim() : null,
      });
      toast({ title: "Relación actualizada" });
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo actualizar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleDelete() {
    if (!link) return;
    try {
      await del.mutateAsync({ id: link.id, network_id: link.network_id });
      toast({ title: "Relación eliminada" });
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const pending = update.isPending || del.isPending;

  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar relación</DialogTitle>
          <DialogDescription>
            Tipa la relación entre las dos entidades y, opcionalmente, añade una nota.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de relación</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  relationTypeId === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-muted"
                }`}
                onClick={() => setRelationTypeId(null)}
              >
                Sin tipo
              </button>
              {relationTypes.map((rt) => {
                const selected = relationTypeId === rt.id;
                return (
                  <button
                    key={rt.id}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      selected ? "text-white" : "hover:bg-muted"
                    }`}
                    style={{
                      backgroundColor: selected ? rt.color : undefined,
                      borderColor: rt.color,
                      color: selected ? "white" : rt.color,
                    }}
                    onClick={() => setRelationTypeId(rt.id)}
                    title={rt.description ?? ""}
                  >
                    {rt.name}
                    {rt.is_symmetric ? " ↔" : " →"}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onCreateRelationType}
                className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                + nuevo tipo
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-comment">Comentario</Label>
            <Textarea
              id="link-comment"
              placeholder="¿Por qué relacionas estas dos entidades?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Eliminar
          </Button>
          <div className="flex-1" />
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
