import { useEffect, useState } from "react";
import { Loader2, Network as NetworkIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useDeleteNetwork, useNetworks } from "@/hooks/useNetworks";

import { CooccurrenceView } from "./CooccurrenceView";
import { NetworkEditorContainer } from "./NetworkEditor";
import { NewNetworkDialog } from "./NewNetworkDialog";

type SubTab = "editor" | "cooccurrence";

export function CodeNetworkPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<SubTab>("editor");
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);

  const { data: networks, isLoading } = useNetworks(projectId);
  const deleteNetwork = useDeleteNetwork();
  const { toast } = useToast();

  // Pick the first network on first load / when the selected one disappears.
  useEffect(() => {
    if (!networks || networks.length === 0) {
      setSelectedNetworkId(null);
      return;
    }
    if (!selectedNetworkId || !networks.some((n) => n.id === selectedNetworkId)) {
      setSelectedNetworkId(networks[0].id);
    }
  }, [networks, selectedNetworkId]);

  const selectedNetwork = networks?.find((n) => n.id === selectedNetworkId) ?? null;

  async function handleDelete() {
    if (!selectedNetwork) return;
    if (!window.confirm(`¿Eliminar la red "${selectedNetwork.name}"?`)) return;
    try {
      await deleteNetwork.mutateAsync({
        id: selectedNetwork.id,
        project_id: selectedNetwork.project_id,
      });
      toast({ title: "Red eliminada" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Red de códigos</h2>
          <p className="text-sm text-muted-foreground">
            Edita redes interpretativas con tipos de relación, o consulta la coocurrencia
            automática derivada de tu codificación.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="cooccurrence">Coocurrencia</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-4 space-y-4">
          {isLoading ? (
            <Skeleton className="h-[600px] w-full" />
          ) : !networks || networks.length === 0 ? (
            <EmptyEditorState projectId={projectId} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedNetworkId ?? undefined}
                  onValueChange={(v) => setSelectedNetworkId(v)}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Selecciona una red" />
                  </SelectTrigger>
                  <SelectContent>
                    {networks.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <NewNetworkDialog projectId={projectId} />

                {selectedNetwork ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleteNetwork.isPending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deleteNetwork.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1 h-4 w-4" />
                    )}
                    Eliminar red
                  </Button>
                ) : null}
              </div>

              {selectedNetwork ? (
                <NetworkEditorContainer
                  key={selectedNetwork.id}
                  network={selectedNetwork}
                  projectId={projectId}
                />
              ) : (
                <Skeleton className="h-[600px] w-full" />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="cooccurrence" className="mt-4">
          <CooccurrenceView projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyEditorState({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <NetworkIcon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">Aún no tienes redes</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Crea una red para arrastrar códigos al lienzo, dibujar relaciones tipadas (causa,
        parte-de, contradice…) y modelar tu marco interpretativo.
      </p>
      <NewNetworkDialog
        projectId={projectId}
        trigger={<Button className="mt-4">Crear primera red</Button>}
      />
    </div>
  );
}
