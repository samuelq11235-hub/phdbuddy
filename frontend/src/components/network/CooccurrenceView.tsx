import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "reactflow";
import { Network as NetworkIcon } from "lucide-react";
import "reactflow/dist/style.css";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCodeGroups } from "@/hooks/useCodeGroups";
import { useCodeNetwork } from "@/hooks/useCodes";
import type { CodeNetworkNode } from "@/types/database";

import { CodeDetailPanel } from "./CodeDetailPanel";
import { SharedCitationsDrawer } from "./SharedCitationsDrawer";

// =====================================================
// Custom React Flow node — sized by total citations
// =====================================================

interface CooccurrenceNodeData {
  label: string;
  color: string;
  size: number;
  diameter: number;
}

function CooccurrenceNode({ data }: { data: CooccurrenceNodeData }) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ width: data.diameter, pointerEvents: "auto" }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        className="rounded-full border-2 border-white shadow-sm transition-shadow hover:shadow-md"
        style={{
          width: data.diameter,
          height: data.diameter,
          backgroundColor: data.color,
          opacity: 0.85,
        }}
        title={`${data.label} — ${data.size} ${data.size === 1 ? "uso" : "usos"}`}
      />
      <span
        className="mt-1 max-w-[160px] truncate text-center text-[11px] font-medium leading-tight text-foreground"
        style={{ fontSize: 11 }}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { cooccurrence: CooccurrenceNode };

// =====================================================
// Layout — circular by default. We could swap for a
// force-directed pass later but the circular fan-out
// reads cleanly for up to ~50 codes and is deterministic
// (helpful for screenshots / reports).
// =====================================================

const CANVAS_W = 900;
const CANVAS_H = 600;

function circularLayout(
  nodes: CodeNetworkNode[],
  maxSize: number
): Node<CooccurrenceNodeData>[] {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const radius = Math.min(CANVAS_W, CANVAS_H) / 2 - 100;
  return nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    const diameter = 24 + (n.size / Math.max(1, maxSize)) * 48;
    const x = cx + radius * Math.cos(angle) - diameter / 2;
    const y = cy + radius * Math.sin(angle) - diameter / 2;
    return {
      id: n.id,
      type: "cooccurrence",
      position: { x, y },
      data: {
        label: n.label,
        color: n.color,
        size: n.size,
        diameter,
      },
    };
  });
}

// =====================================================
// Component
// =====================================================

export function CooccurrenceView({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <CooccurrenceViewInner projectId={projectId} />
    </ReactFlowProvider>
  );
}

function CooccurrenceViewInner({ projectId }: { projectId: string }) {
  const [groupId, setGroupId] = useState<string>("__all__");
  const [minWeight, setMinWeight] = useState<number>(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [edgePair, setEdgePair] = useState<{
    a: CodeNetworkNode;
    b: CodeNetworkNode;
    weight: number;
  } | null>(null);

  const { data: groups = [] } = useCodeGroups(projectId);
  const { data: network, isLoading } = useCodeNetwork(projectId, {
    codeGroupId: groupId === "__all__" ? null : groupId,
    minWeight,
  });

  const nodesById = useMemo(() => {
    const m = new Map<string, CodeNetworkNode>();
    for (const n of network?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [network?.nodes]);

  const maxWeight = useMemo(() => {
    let m = 1;
    for (const e of network?.edges ?? []) m = Math.max(m, e.weight);
    return m;
  }, [network?.edges]);

  const maxSize = useMemo(() => {
    let m = 1;
    for (const n of network?.nodes ?? []) m = Math.max(m, n.size);
    return m;
  }, [network?.nodes]);

  // -----------------------------------------------------
  // Build React Flow state from the network response
  // -----------------------------------------------------
  const [nodes, setNodes, onNodesChange] = useNodesState<CooccurrenceNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    setNodes(circularLayout(network?.nodes ?? [], maxSize));
  }, [network?.nodes, maxSize, setNodes]);

  useEffect(() => {
    const built = (network?.edges ?? []).map((e) => {
      const w = e.weight;
      const opacity = 0.2 + (w / maxWeight) * 0.7;
      const stroke = `rgba(124, 58, 237, ${opacity.toFixed(2)})`;
      return {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        animated: false,
        style: {
          stroke,
          strokeWidth: 1 + (w / maxWeight) * 5,
        },
        label: w > 1 ? String(w) : undefined,
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
        labelBgPadding: [3, 1] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.85 },
        data: { weight: w },
      };
    });
    setEdges(built);
  }, [network?.edges, maxWeight, setEdges]);

  // -----------------------------------------------------
  // Interactions
  // -----------------------------------------------------
  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    setSelectedNodeId(node.id);
  };
  const onEdgeClick: EdgeMouseHandler = (_evt, edge) => {
    const a = nodesById.get(edge.source);
    const b = nodesById.get(edge.target);
    const weight =
      (edge.data as { weight?: number } | undefined)?.weight ?? 0;
    if (a && b) setEdgePair({ a, b, weight });
  };

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Coocurrencia automática</h3>
        <p className="text-sm text-muted-foreground">
          Dos códigos se conectan cuando comparten al menos una cita; el grosor de la línea
          equivale al número de citas compartidas. Solo se dibujan aristas con evidencia real.
          Haz clic en una arista para ver esas citas; en un nodo, para abrir su detalle.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Grupo</span>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos los códigos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Peso mínimo</span>
          <Select
            value={String(minWeight)}
            onValueChange={(v) => setMinWeight(parseInt(v, 10))}
          >
            <SelectTrigger className="h-8 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 5, 8, 13].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  ≥ {n} {n === 1 ? "cita" : "citas"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {network ? (
            <>
              {network.stats.nodeCount}{" "}
              {network.stats.nodeCount === 1 ? "código" : "códigos"} ·{" "}
              {network.stats.edgeCount}{" "}
              {network.stats.edgeCount === 1 ? "conexión" : "conexiones"}
            </>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[600px] w-full" />
      ) : !network || network.nodes.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          className={`grid gap-3 ${
            selectedNode ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"
          }`}
        >
          <div className="rounded-xl border bg-card" style={{ height: 600 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              nodeTypes={NODE_TYPES}
              connectionMode={ConnectionMode.Loose}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeStrokeWidth={2}
                nodeColor={(n) =>
                  (n.data as CooccurrenceNodeData)?.color ?? "#94A3B8"
                }
              />
            </ReactFlow>
          </div>

          <CodeDetailPanel
            projectId={projectId}
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}

      <SharedCitationsDrawer
        projectId={projectId}
        open={!!edgePair}
        onOpenChange={(o) => !o && setEdgePair(null)}
        codeA={edgePair?.a ?? null}
        codeB={edgePair?.b ?? null}
        weight={edgePair?.weight ?? 0}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <NetworkIcon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">Aún no hay nada que mostrar</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Codifica al menos un par de citas con varios códigos cada una y la red aparecerá aquí.
        Si ya lo hiciste, prueba bajando el peso mínimo o cambiando el grupo.
      </p>
    </div>
  );
}
