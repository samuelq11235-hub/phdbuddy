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
  type NodeMouseHandler,
  type OnConnect,
  type NodeChange,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCodes } from "@/hooks/useCodes";
import { useQuotations } from "@/hooks/useQuotations";
import { useMemos } from "@/hooks/useMemos";
import { useDocuments } from "@/hooks/useDocuments";
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
  LinkEntityType,
  Network,
  NetworkLayout,
  RelationType,
} from "@/types/database";
import { Layers3, Sparkles, Wand2 } from "lucide-react";

import { AddNodesDialog } from "./AddNodesDialog";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { QuotationNode, type QuotationNodeData } from "./QuotationNode";
import { MemoNode, type MemoNodeData } from "./MemoNode";
import { DocumentNode, type DocumentNodeData } from "./DocumentNode";
import { EdgeEditDialog } from "./EdgeEditDialog";
import { NewRelationTypeDialog } from "./NewRelationTypeDialog";

const NODE_TYPES: NodeTypes = {
  code: CodeNode,
  quotation: QuotationNode,
  memo: MemoNode,
  document: DocumentNode,
};

// Each node type has a different intrinsic size — dagre needs to know
// roughly the bounding box to lay things out without overlap.
const NODE_DIM: Record<LinkEntityType, { w: number; h: number }> = {
  code: { w: 180, h: 56 },
  quotation: { w: 240, h: 88 },
  memo: { w: 200, h: 72 },
  document: { w: 190, h: 60 },
};

// =====================================================
// Helpers — node key, layout, ID translation
// =====================================================

function makeNodeKey(type: LinkEntityType, id: string) {
  return `${type}:${id}`;
}

function parseNodeKey(key: string): { type: LinkEntityType; id: string } | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  const type = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!id) return null;
  if (type !== "code" && type !== "quotation" && type !== "memo" && type !== "document") {
    return null;
  }
  return { type: type as LinkEntityType, id };
}

// dagre auto-layout with per-type bounding boxes.
function dagreLayout(nodes: Node[], edges: Edge[], direction: "LR" | "TB"): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 140,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const dim = NODE_DIM[(n.type ?? "code") as LinkEntityType] ?? NODE_DIM.code;
    g.setNode(n.id, { width: dim.w, height: dim.h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const dim = NODE_DIM[(n.type ?? "code") as LinkEntityType] ?? NODE_DIM.code;
    return {
      ...n,
      position: { x: pos.x - dim.w / 2, y: pos.y - dim.h / 2 },
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
  const { data: quotations = [] } = useQuotations(projectId);
  const { data: memos = [] } = useMemos(projectId);
  const { data: documents = [] } = useDocuments(projectId);
  const { data: liveNetwork } = useNetwork(network.id);
  const { data: relationTypes = [] } = useRelationTypes(projectId);
  const { data: links = [] } = useLinks(network.id);

  const updateLayout = useUpdateNetworkLayout();
  const createLink = useCreateLink();
  const { toast } = useToast();
  const navigate = useNavigate();

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);
  const quotationById = useMemo(
    () => new Map(quotations.map((q) => [q.id, q])),
    [quotations]
  );
  const memoById = useMemo(() => new Map(memos.map((m) => [m.id, m])), [memos]);
  const documentById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);
  const relationTypeById = useMemo(
    () => new Map(relationTypes.map((rt) => [rt.id, rt])),
    [relationTypes]
  );
  const effectiveLayout: NetworkLayout = liveNetwork?.layout ?? network.layout ?? {};

  // -----------------------------------------------------
  // React Flow state — derived from links/codes but kept
  // local so dragging is responsive without re-rendering.
  // -----------------------------------------------------
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [showCreateRelationType, setShowCreateRelationType] = useState(false);

  // Track which entities are present in this network. An entity is "in
  // the network" iff (a) it has at least one link, OR (b) it has a
  // saved position in the layout. This means an isolated node added
  // via "Añadir nodos" persists immediately on first move.
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
    const built: Node[] = [];

    let i = 0;
    for (const key of presentNodeKeys) {
      const parsed = parseNodeKey(key);
      if (!parsed) continue;

      // Stagger fallback positions on a grid so dagre has something
      // reasonable to start from when the user clicks Auto-layout.
      const fallbackX = 200 + (i % 5) * 260;
      const fallbackY = 80 + Math.floor(i / 5) * 160;
      const saved = effectiveLayout[key];
      const position = saved ?? { x: fallbackX, y: fallbackY };
      i++;

      if (parsed.type === "code") {
        const code = codeById.get(parsed.id);
        if (!code) continue;
        const data: CodeNodeData = {
          label: code.name,
          color: code.color,
          usageCount: code.usage_count,
        };
        built.push({ id: key, type: "code", position, data });
      } else if (parsed.type === "quotation") {
        const quote = quotationById.get(parsed.id);
        if (!quote) continue;
        const codeColors = (quote.codes ?? []).map((c) => c.color).filter(Boolean);
        const data: QuotationNodeData = {
          preview: (quote.content ?? "").slice(0, 140),
          documentTitle: quote.document_title ?? "(sin título)",
          codeColors,
        };
        built.push({ id: key, type: "quotation", position, data });
      } else if (parsed.type === "memo") {
        const memo = memoById.get(parsed.id);
        if (!memo) continue;
        // Strip rich-text HTML for the preview line.
        const plain = memo.content
          ? memo.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const data: MemoNodeData = {
          title: memo.title,
          preview: plain.slice(0, 100),
          kind: memo.kind,
        };
        built.push({ id: key, type: "memo", position, data });
      } else if (parsed.type === "document") {
        const doc = documentById.get(parsed.id);
        if (!doc) continue;
        const data: DocumentNodeData = {
          title: doc.title,
          kind: doc.kind,
          quotationCount: doc.quotation_count,
        };
        built.push({ id: key, type: "document", position, data });
      }
    }

    setNodes(built);
  }, [presentNodeKeys, codeById, quotationById, memoById, documentById, effectiveLayout, setNodes]);

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
    (next: Node[]) => {
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
      const settled = changes.some(
        (c) => c.type === "position" && (c as { dragging?: boolean }).dragging === false
      );
      if (settled) {
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

  // Double-click on a node opens the actual entity in another tab/route.
  // Atlas.ti's network editor uses the same idiom.
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const parsed = parseNodeKey(node.id);
      if (!parsed) return;
      if (parsed.type === "document") {
        navigate(`/projects/${projectId}/documents/${parsed.id}`);
      } else if (parsed.type === "quotation") {
        const quote = quotationById.get(parsed.id);
        if (quote?.document_id) {
          navigate(
            `/projects/${projectId}/documents/${quote.document_id}?quotation=${quote.id}`
          );
        }
      }
      // For codes and memos we leave the dblclick as a no-op — the side
      // panels in the workspace already host their detail UIs.
    },
    [navigate, projectId, quotationById]
  );

  // -----------------------------------------------------
  // Toolbar actions
  // -----------------------------------------------------
  const handleAddNodes = useCallback(
    (selection: { type: LinkEntityType; id: string }[]) => {
      let baseY = 80;
      let baseX = 80;
      if (nodes.length > 0) {
        const maxY = Math.max(...nodes.map((n) => n.position.y));
        baseY = maxY + 160;
        baseX = 80;
      }

      const next: Node[] = [...nodes];
      const newLayoutPatch: NetworkLayout = {};
      for (let i = 0; i < selection.length; i++) {
        const sel = selection[i];
        const key = makeNodeKey(sel.type, sel.id);
        if (next.some((n) => n.id === key)) continue;
        const pos = { x: baseX + (i % 5) * 260, y: baseY + Math.floor(i / 5) * 160 };

        if (sel.type === "code") {
          const code = codeById.get(sel.id);
          if (!code) continue;
          next.push({
            id: key,
            type: "code",
            position: pos,
            data: {
              label: code.name,
              color: code.color,
              usageCount: code.usage_count,
            } satisfies CodeNodeData,
          });
        } else if (sel.type === "quotation") {
          const quote = quotationById.get(sel.id);
          if (!quote) continue;
          const codeColors = (quote.codes ?? []).map((c) => c.color).filter(Boolean);
          next.push({
            id: key,
            type: "quotation",
            position: pos,
            data: {
              preview: (quote.content ?? "").slice(0, 140),
              documentTitle: quote.document_title ?? "(sin título)",
              codeColors,
            } satisfies QuotationNodeData,
          });
        } else if (sel.type === "memo") {
          const memo = memoById.get(sel.id);
          if (!memo) continue;
          const plain = memo.content
            ? memo.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : "";
          next.push({
            id: key,
            type: "memo",
            position: pos,
            data: {
              title: memo.title,
              preview: plain.slice(0, 100),
              kind: memo.kind,
            } satisfies MemoNodeData,
          });
        } else if (sel.type === "document") {
          const doc = documentById.get(sel.id);
          if (!doc) continue;
          next.push({
            id: key,
            type: "document",
            position: pos,
            data: {
              title: doc.title,
              kind: doc.kind,
              quotationCount: doc.quotation_count,
            } satisfies DocumentNodeData,
          });
        }
        newLayoutPatch[key] = pos;
      }
      setNodes(next);
      const layout: NetworkLayout = { ...effectiveLayout, ...newLayoutPatch };
      updateLayout.mutate({ networkId: network.id, layout });
    },
    [
      codeById,
      documentById,
      effectiveLayout,
      memoById,
      network.id,
      nodes,
      quotationById,
      setNodes,
      updateLayout,
    ]
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
          /* keep going on individual failures */
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

  const alreadyAddedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) set.add(n.id);
    return set;
  }, [nodes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AddNodesDialog
          codes={codes}
          quotations={quotations}
          memos={memos}
          documents={documents}
          alreadyAdded={alreadyAddedKeys}
          onConfirm={handleAddNodes}
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

      <div className="rounded-xl border bg-card" style={{ height: 600 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeDoubleClick={onNodeDoubleClick}
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
            nodeColor={(n) => {
              const t = (n.type ?? "code") as LinkEntityType;
              if (t === "code") return (n.data as CodeNodeData)?.color ?? "#94A3B8";
              if (t === "quotation") return "#f59e0b";
              if (t === "memo") return "#8b5cf6";
              if (t === "document") return "#0ea5e9";
              return "#94A3B8";
            }}
          />
        </ReactFlow>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          La red está vacía. Pulsa{" "}
          <span className="font-medium text-foreground">Añadir nodos</span> y combina
          códigos, citas, memos y documentos. Doble click sobre un nodo abre la
          entidad original.
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

export type { Code };
