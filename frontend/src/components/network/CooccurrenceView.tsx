import { useMemo } from "react";
import { Network as NetworkIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useCodes, useCodeCooccurrence } from "@/hooks/useCodes";

export function CooccurrenceView({ projectId }: { projectId: string }) {
  const { data: codes, isLoading: codesLoading } = useCodes(projectId);
  const { data: cooccurrence, isLoading: cooLoading } = useCodeCooccurrence(projectId);

  const isLoading = codesLoading || cooLoading;

  const network = useMemo(() => {
    if (!codes || !cooccurrence) return null;
    return buildLayout(codes, cooccurrence);
  }, [codes, cooccurrence]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Coocurrencia automática</h3>
        <p className="text-sm text-muted-foreground">
          Vista derivada de los datos: dos códigos se conectan cuando comparten al menos una
          cita. El grosor refleja el número de citas compartidas; el tamaño del nodo, el uso
          total. Usa la pestaña <span className="font-medium">Editor</span> para crear redes
          editables.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-[500px] w-full" />
      ) : !network || network.nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <NetworkIcon className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Aún no hay nada que mostrar</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Codifica al menos un par de citas con varios códigos cada una y la red aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <NetworkSVG network={network} />
          <NetworkLegend network={network} />
        </div>
      )}
    </div>
  );
}

interface LayoutNode {
  id: string;
  name: string;
  color: string;
  usage: number;
  x: number;
  y: number;
  r: number;
}
interface LayoutEdge {
  a: LayoutNode;
  b: LayoutNode;
  weight: number;
}
interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  maxEdge: number;
}

function buildLayout(
  codes: NonNullable<ReturnType<typeof useCodes>["data"]>,
  cooccurrence: NonNullable<ReturnType<typeof useCodeCooccurrence>["data"]>
): LayoutData {
  const usedIds = new Set<string>();
  for (const co of cooccurrence ?? []) {
    usedIds.add(co.code_a);
    usedIds.add(co.code_b);
  }
  const visibleCodes = (codes ?? []).filter((c) => usedIds.has(c.id) || c.usage_count > 0);

  const width = 720;
  const height = 540;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 60;

  const maxUsage = Math.max(1, ...visibleCodes.map((c) => c.usage_count));
  const nodes: LayoutNode[] = visibleCodes.map((c, i) => {
    const angle = (i / Math.max(1, visibleCodes.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      usage: c.usage_count,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      r: 8 + (c.usage_count / maxUsage) * 14,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = [];
  let maxEdge = 0;
  for (const co of cooccurrence ?? []) {
    const a = byId.get(co.code_a);
    const b = byId.get(co.code_b);
    if (!a || !b) continue;
    const w = Number(co.occurrences);
    if (w > maxEdge) maxEdge = w;
    edges.push({ a, b, weight: w });
  }
  return { nodes, edges, width, height, maxEdge };
}

function NetworkSVG({ network }: { network: LayoutData }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <svg
        viewBox={`0 0 ${network.width} ${network.height}`}
        className="block w-full"
        role="img"
        aria-label="Red de co-ocurrencia de códigos"
      >
        <g>
          {network.edges.map((e, i) => (
            <line
              key={i}
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.15 + (e.weight / network.maxEdge) * 0.6}
              strokeWidth={1 + (e.weight / network.maxEdge) * 4}
            />
          ))}
        </g>
        <g>
          {network.nodes.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity={0.8} stroke="white" strokeWidth={2}>
                <title>
                  {n.name} — {n.usage} {n.usage === 1 ? "uso" : "usos"}
                </title>
              </circle>
              <text
                x={n.x}
                y={n.y + n.r + 14}
                textAnchor="middle"
                className="select-none fill-foreground text-[11px] font-medium"
              >
                {truncate(n.name, 22)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function NetworkLegend({ network }: { network: LayoutData }) {
  const top = [...network.edges].sort((a, b) => b.weight - a.weight).slice(0, 8);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-3">
        <h3 className="text-sm font-semibold">Conexiones principales</h3>
        {top.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Aún no hay códigos co-ocurrentes.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {top.map((e, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 font-medium">
                    <DotColor color={e.a.color} /> {e.a.name}
                    <span className="px-1.5 text-muted-foreground">↔</span>
                    <DotColor color={e.b.color} /> {e.b.name}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
                    {e.weight}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {network.nodes.length} {network.nodes.length === 1 ? "código" : "códigos"} ·{" "}
        {network.edges.length} {network.edges.length === 1 ? "conexión" : "conexiones"}
      </p>
    </div>
  );
}

function DotColor({ color }: { color: string }) {
  return (
    <span
      className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
