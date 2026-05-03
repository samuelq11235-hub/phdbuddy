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
import { useCreateNetwork, useSeedRelationTypes } from "@/hooks/useNetworks";
import { useToast } from "@/hooks/use-toast";
import type { Network } from "@/types/database";

export function NewNetworkDialog({
  projectId,
  trigger,
  onCreated,
}: {
  projectId: string;
  trigger?: ReactNode;
  onCreated?: (network: Network) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useCreateNetwork();
  const seed = useSeedRelationTypes();
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      // Seed the relation vocabulary the first time the user creates a
      // network in this project. The function is idempotent so re-runs
      // are safe and cheap.
      await seed.mutateAsync(projectId).catch(() => undefined);
      const net = await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast({ title: "Red creada", description: net.name });
      onCreated?.(net);
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear la red",
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
        if (!o) {
          setName("");
          setDescription("");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button>Nueva red</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva red</DialogTitle>
            <DialogDescription>
              Una red es un diagrama editable: arrastra códigos al lienzo y dibuja relaciones
              tipadas entre ellos. Puedes tener varias redes por proyecto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="network-name">Nombre</Label>
            <Input
              id="network-name"
              placeholder="p. ej., Mapa conceptual de afecto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="network-desc">Descripción (opcional)</Label>
            <Textarea
              id="network-desc"
              placeholder="¿Qué pretendes representar con esta red?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear red
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
