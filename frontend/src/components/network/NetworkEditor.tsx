import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeMouseHandler,
  type OnConnect,
  type NodeChange,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCodes } from "@/hooks/useCodes";
import {
  useCreateLink,
  useLinks,
  useNetwork,
  useRelationTypes,
  useUpdateNetworkLayout,
} from "@/hooks/useNetworks";
import { api } from "@/lib/api";
import type {
  Code,
  Link,
  Network,
  NetworkLayout,
  RelationType,
} from "@/types/database";
import { Layers3, Sparkles, Wand2 } from "lucide-react";

import { AddCodesDialog } from "./AddCodesDialog";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { EdgeEditDialog } from "./EdgeEditDialog";
import { NewRelationTypeDialog } from "./NewRelationTypeDialog";

const NODE_TYPES: NodeTypes = { code: CodeNode };

// =====================================================
// Helpers — node key, layout, ID translation
// =====================================================

// React Flow needs string IDs that are stable across the lifetime of a
// node. We use "<entity_type>:<entity_id>" so the same code can live in
// multiple networks at different positions, without ever colliding with
// quotation/memo nodes (future work, but the schema already supports it).
function makeNodeKey(type: "code" | "quotation" | "memo" | "document", id: string) {
  return `${type}:${id}`;
}

function parseNodeKey(key: string): { type: "code" | "quotation" | "memo" | "document"; id: string } | null {
  const [type, id] = key.split(":");
  if (!type || !id) return null;
  if (type !== "code" && type !== "quotation" && type !== "memo" && type !== "document") return null;
  return { type, id };
}

// dagre auto-layout — we only call it when the user clicks "Auto-layout",
// or for nodes that don't yet have a saved position. The graph direction
// (LR / TB) is configurable via the toolbar.
function dagreLayout(
  nodes: Node<CodeNodeData>[],
  edges: Edge[],
  direction: "LR" | "TB"
): Node<CodeNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: 70,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: 180, height: 56 });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    return {
      ...n,
      // dagre returns the centre; React Flow expects the top-left.
      position: { x: pos.x - 90, y: pos.y - 28 },
    };
  });
}

// =====================================================
// Outer wrapper — hooks need ReactFlowProvider context
// =====================================================

export function NetworkEditorContainer({
  network,
  projectId,
}: {
  network: Network;
  projectId: string;
}) {
  return (
    <ReactFlowProvider>
      <NetworkEditor network={network} projectId={projectId} />
    </ReactFlowProvider>
  );
}

// =====================================================
// Editor
// =====================================================

function NetworkEditor({ network, projectId }: { network: Network; projectId: string }) {
  const { data: codes = [] } = useCodes(projectId);
  const { data: liveNetwork } = useNetwork(network.id);
  const { data: relationTypes = [] } = useRelationTypes(projectId);
  const { data: links = [] } = useLinks(network.id);

  const updateLayout = useUpdateNetworkLayout();
  const createLink = useCreateLink();
  const { toast } = useToast();

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);
  const relationTypeById = useMemo(
    () => new Map(relationTypes.map((rt) => [rt.id, rt])),
    [relationTypes]
  );
  const effectiveLayout: NetworkLayout = liveNetwork?.layout ?? network.layout ?? {};

  // -----------------------------------------------------
  // React Flow state — derived from links/codes but kept
  // local so dragging is responsive without re-rendering.
  // -----------------------------------------------------
  const [nodes, setNodes, onNodesChange] = useNodesState<CodeNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [showCreateRelationType, setShowCreateRelationType] = useState(false);

  // Track which entities are present in this network. A code is "in the
  // network" iff (a) it has at least one link, OR (b) it has a saved
  // position in the layout. This means an isolated code can be added by
  // the user via "Añadir códigos" and persists immediately on first move.
  const presentNodeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const k of Object.keys(effectiveLayout)) keys.add(k);
    for (const link of links) {
      keys.add(makeNodeKey(link.source_type, link.source_id));
      keys.add(makeNodeKey(link.target_type, link.target_id));
    }
    return keys;
  }, [effectiveLayout, links]);

  // -----------------------------------------------------
  // Sync DB → React Flow state when data changes
  // -----------------------------------------------------
  useEffect(() => {
    const built: Node<CodeNodeData>[] = [];

    let i = 0;
    for (const key of presentNodeKeys) {
      const parsed = parseNodeKey(key);
      if (!parsed) continue;
      if (parsed.type !== "code") continue; // only codes for now (F4 scope)
      const code = codeById.get(parsed.id);
      if (!code) continue;

      const saved = effectiveLayout[key];
      // For nodes without a saved position we lay them out lightly along
      // a circle so dagre has something reasonable to start from when the
      // user clicks Auto-layout. Pure (0,0) would stack them all.
      const fallbackX = 200 + (i % 6) * 220;
      const fallbackY = 80 + Math.floor(i / 6) * 140;
      i++;

      built.push({
        id: key,
        type: "code",
        position: saved ?? { x: fallbackX, y: fallbackY },
        data: {
          label: code.name,
          color: code.color,
          usageCount: code.usage_count,
        },
      });
    }

    setNodes(built);
  }, [presentNodeKeys, codeById, effectiveLayout, setNodes]);

  useEffect(() => {
    const built: Edge[] = links.map((link) => {
      const rt = link.relation_type_id ? relationTypeById.get(link.relation_type_id) : null;
      const color = rt?.color ?? "#94A3B8";
      return {
        id: link.id,
        source: makeNodeKey(link.source_type, link.source_id),
        target: makeNodeKey(link.target_type, link.target_id),
        label: rt?.name,
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.85 },
        style: { stroke: color, strokeWidth: 1.6 },
        markerEnd: rt?.is_symmetric
          ? undefined
          : { type: MarkerType.ArrowClosed, color },
        markerStart: rt?.is_symmetric
          ? { type: MarkerType.ArrowClosed, color }
          : undefined,
        data: { link },
      };
    });
    setEdges(built);
  }, [links, relationTypeById, setEdges]);

  // -----------------------------------------------------
  // Persist layout (debounced) when user drags nodes
  // -----------------------------------------------------
  const debounceRef = useRef<number | null>(null);

  const persistLayout = useCallback(
    (next: Node<CodeNodeData>[]) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const layout: NetworkLayout = {};
        for (const n of next) {
          layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
        }
        updateLayout.mutate(
          { networkId: network.id, layout },
          {
            onError: (err) => {
              toast({
                variant: "destructive",
                title: "No se pudo guardar la disposición",
                description: err instanceof Error ? err.message : undefined,
              });
            },
          }
        );
      }, 600);
    },
    [network.id, toast, updateLayout]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // We only care about drag-end to persist (dragging emits many
      // intermediate position changes — flushing each would hammer the DB).
      const settled = changes.some(
        (c) => c.type === "position" && (c as { dragging?: boolean }).dragging === false
      );
      if (settled) {
        // Pull the freshest node positions from React Flow's local state.
        setNodes((current) => {
          persistLayout(current);
          return current;
        });
      }
    },
    [onNodesChange, persistLayout, setNodes]
  );

  // -----------------------------------------------------
  // Connect — when the user drags a new edge between nodes
  // -----------------------------------------------------
  const onConnect: OnConnect = useCallback(
    async (params: Connection) => {
      if (!params.source || !params.target) return;
      if (params.source === params.target) {
        toast({ title: "No puedes enlazar un nodo consigo mismo" });
        return;
      }
      const src = parseNodeKey(params.source);
      const tgt = parseNodeKey(params.target);
      if (!src || !tgt) return;

      // Optimistic edge so the line shows up before the round-trip.
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            style: { stroke: "#94A3B8", strokeWidth: 1.6, strokeDasharray: "4 4" },
          },
          eds
        )
      );

      try {
        const link = await createLink.mutateAsync({
          projectId,
          networkId: network.id,
          sourceType: src.type,
          sourceId: src.id,
          targetType: tgt.type,
          targetId: tgt.id,
        });
        // Open the edit dialog right away so the user can pick a relation
        // type — Atlas.ti does the same UX flow.
        setEditingLink(link);
      } catch (err) {
        toast({
          variant: "destructive",
          title: "No se pudo crear la relación",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [createLink, network.id, projectId, setEdges, toast]
  );

  const onEdgeClick: EdgeMouseHandler = useCallback((_evt, edge) => {
    const link = (edge.data as { link?: Link } | undefined)?.link;
    if (link) setEditingLink(link);
  }, []);

  // -----------------------------------------------------
  // Toolbar actions
  // -----------------------------------------------------
  const handleAddCodes = useCallback(
    (codeIds: string[]) => {
      // Append at staggered positions just below the current bbox so new
      // nodes don't pile on existing ones.
      let baseY = 80;
      let baseX = 80;
      if (nodes.length > 0) {
        const maxY = Math.max(...nodes.map((n) => n.position.y));
        baseY = maxY + 140;
        baseX = 80;
      }

      const next: Node<CodeNodeData>[] = [...nodes];
      const newLayoutPatch: NetworkLayout = {};
      for (let i = 0; i < codeIds.length; i++) {
        const code = codeById.get(codeIds[i]);
        if (!code) continue;
        const key = makeNodeKey("code", code.id);
        if (next.some((n) => n.id === key)) continue;
        const pos = { x: baseX + (i % 6) * 220, y: baseY + Math.floor(i / 6) * 140 };
        next.push({
          id: key,
          type: "code",
          position: pos,
          data: { label: code.name, color: code.color, usageCount: code.usage_count },
        });
        newLayoutPatch[key] = pos;
      }
      setNodes(next);
      // Persist immediately so a refresh keeps the new nodes.
      const layout: NetworkLayout = { ...effectiveLayout, ...newLayoutPatch };
      updateLayout.mutate({ networkId: network.id, layout });
    },
    [codeById, effectiveLayout, network.id, nodes, setNodes, updateLayout]
  );

  const handleAutoLayout = useCallback(
    (direction: "LR" | "TB") => {
      const laidOut = dagreLayout(nodes, edges, direction);
      setNodes(laidOut);
      persistLayout(laidOut);
    },
    [edges, nodes, persistLayout, setNodes]
  );

  const [aiPending, setAiPending] = useState(false);
  const handleSuggestRelations = useCallback(async () => {
    const codeIds = nodes
      .map((n) => parseNodeKey(n.id))
      .filter((p): p is { type: "code"; id: string } => p?.type === "code")
      .map((p) => p.id);
    if (codeIds.length < 2) {
      toast({ title: "Añade al menos 2 códigos a la red para sugerir relaciones." });
      return;
    }
    try {
      setAiPending(true);
      const res = await api.suggestRelations({ networkId: network.id, codeIds });
      if (res.relations.length === 0) {
        toast({
          title: "Sin sugerencias",
          description:
            "Claude no encontró relaciones suficientemente claras. Prueba con un subconjunto distinto o codifica más citas.",
        });
        return;
      }

      // Auto-apply each suggested relation as a real link. Users can
      // delete the ones they don't like from the canvas afterwards.
      let applied = 0;
      for (const rel of res.relations) {
        const rt = relationTypes.find(
          (t) => t.name.toLowerCase() === rel.relation_type_name.toLowerCase()
        );
        try {
          await createLink.mutateAsync({
            projectId,
            networkId: network.id,
            sourceType: "code",
            sourceId: rel.source_code_id,
            targetType: "code",
            targetId: rel.target_code_id,
            relationTypeId: rt?.id ?? null,
            comment: rel.rationale,
          });
          applied++;
        } catch {
          /* ignore individual failures, keep going */
        }
      }
      toast({
        title: `Sugeridas ${applied} relaciones`,
        description: "Revísalas en el lienzo y elimina las que no te convenzan.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudieron sugerir relaciones",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAiPending(false);
    }
  }, [createLink, network.id, nodes, projectId, relationTypes, toast]);

  const codesAlreadyAdded = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      const parsed = parseNodeKey(n.id);
      if (parsed?.type === "code") set.add(parsed.id);
    }
    return set;
  }, [nodes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AddCodesDialog
          codes={codes}
          alreadyAdded={codesAlreadyAdded}
          onConfirm={handleAddCodes}
        />
        <Button variant="outline" size="sm" onClick={() => handleAutoLayout("LR")}>
          <Layers3 className="mr-1 h-4 w-4" />
          Auto-layout (horizontal)
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleAutoLayout("TB")}>
          <Layers3 className="mr-1 h-4 w-4 rotate-90" />
          Auto-layout (vertical)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateRelationType(true)}
        >
          <Wand2 className="mr-1 h-4 w-4" />
          Tipo de relación
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={handleSuggestRelations}
          disabled={aiPending || nodes.length < 2}
        >
          <Sparkles className="mr-1 h-4 w-4" />
          {aiPending ? "Pensando…" : "Sugerir relaciones (IA)"}
        </Button>
      </div>

      <div
        className="rounded-xl border bg-card"
        style={{ height: 600 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          nodeTypes={NODE_TYPES}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={null}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={(n) => (n.data as CodeNodeData)?.color ?? "#94A3B8"}
          />
        </ReactFlow>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          La red está vacía. Pulsa{" "}
          <span className="font-medium text-foreground">Añadir códigos</span> para empezar a
          colocar tarjetas en el lienzo y arrastra entre dos códigos para crear relaciones.
        </div>
      ) : null}

      <EdgeEditDialog
        link={editingLink}
        relationTypes={relationTypes as RelationType[]}
        onClose={() => setEditingLink(null)}
        onCreateRelationType={() => setShowCreateRelationType(true)}
      />

      <NewRelationTypeDialog
        projectId={projectId}
        open={showCreateRelationType}
        onOpenChange={setShowCreateRelationType}
      />
    </div>
  );
}

// Suppress an unused-import warning for the `Code` re-export — kept here
// so future PRs that add quotation/memo nodes don't have to re-import it.
export type { Code };
