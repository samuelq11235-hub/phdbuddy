import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCodes, useCodeCooccurrence } from "@/hooks/useCodes";
import type { Code, CodeCooccurrenceRow } from "@/types/database";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

interface Particle {
  id: string;
  name: string;
  color: string;
  count: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Spring {
  a: number;
  b: number;
  /** Higher weight = closer rest distance + stronger pull. */
  weight: number;
}

const TOP_N = 60;

/**
 * A concept cloud: bubbles for the most-used codes, sized by usage,
 * pulled together by co-occurrence (Jaccard) and pushed apart by a soft
 * repulsion. The result is an emergent map where codes that frequently
 * appear in the same documents form natural clusters — exactly the
 * intuition a qualitative researcher uses when "concept-mapping" by hand.
 *
 * The simulator is a small Verlet-style integrator with a O(n²) repulsion
 * pass. We cap N at 60 codes which keeps it well under 1ms/step on any
 * recent laptop. After ~250 steps the layout stabilises and we stop.
 */
export function ConceptCloud({ projectId }: Props) {
  const { data: codes, isLoading: codesLoading } = useCodes(projectId);
  const { data: cooc, isLoading: coocLoading } = useCodeCooccurrence(projectId);

  const [nonce, setNonce] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const particles = useMemo<Particle[]>(() => {
    if (!codes) return [];
    return buildParticles(codes);
  }, [codes, nonce]);

  const springs = useMemo<Spring[]>(() => {
    if (!cooc || particles.length === 0) return [];
    return buildSprings(particles, cooc);
  }, [cooc, particles]);

  // Run the simulation in a dedicated effect so React keeps in sync but
  // we only repaint at the end (we don't need per-frame animation here).
  const [layout, setLayout] = useState<Particle[] | null>(null);
  useEffect(() => {
    if (particles.length === 0) {
      setLayout([]);
      return;
    }
    const next = simulate(particles.map((p) => ({ ...p })), springs, 250);
    setLayout(next);
  }, [particles, springs]);

  const isLoading = codesLoading || coocLoading;
  const isEmpty = !isLoading && (!codes || codes.length === 0);

  // Compute bounds for an auto-fit viewBox.
  const viewBox = useMemo(() => {
    if (!layout || layout.length === 0) return "-300 -200 600 400";
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of layout) {
      minX = Math.min(minX, p.x - p.r - 8);
      maxX = Math.max(maxX, p.x + p.r + 8);
      minY = Math.min(minY, p.y - p.r - 14);
      maxY = Math.max(maxY, p.y + p.r + 14);
    }
    const w = Math.max(maxX - minX, 200);
    const h = Math.max(maxY - minY, 150);
    return `${minX} ${minY} ${w} ${h}`;
  }, [layout]);

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No hay códigos todavía — codifica algunos documentos para ver la nube.
        </p>
      </div>
    );
  }

  if (isLoading || !layout) {
    return <Skeleton className="h-[60vh] w-full" />;
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-soft">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">Concept Cloud</h3>
          <p className="text-[11px] text-muted-foreground">
            {layout.length} códigos. Tamaño = uso. Cercanía = co-ocurrencia.
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}
            aria-label="Alejar"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setZoom(1)}
            aria-label="Ajustar"
            title="Restablecer zoom"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
            aria-label="Acercar"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNonce((n) => n + 1)}
            className="ml-1"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Re-layout
          </Button>
        </div>
      </header>

      <div className="relative h-[68vh] overflow-hidden bg-surface-2">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
        >
          {/* Springs as faint lines so clusters are visible */}
          <g opacity={0.18}>
            {springs.map((s, i) => {
              const a = layout[s.a];
              const b = layout[s.b];
              if (!a || !b) return null;
              const w = Math.max(0.4, Math.min(2.4, s.weight * 5));
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={w}
                />
              );
            })}
          </g>

          {/* Bubbles */}
          {layout.map((p) => {
            const isHover = hovered === p.id;
            return (
              <g
                key={p.id}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "default" }}
                opacity={hovered && !isHover ? 0.45 : 1}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  fill={p.color}
                  fillOpacity={0.78}
                  stroke="white"
                  strokeWidth={1.5}
                  className="transition-opacity"
                />
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.max(9, Math.min(16, p.r * 0.38))}
                  fontWeight={600}
                  fill="#0f172a"
                  className={cn(
                    "pointer-events-none select-none",
                    "[paint-order:stroke]"
                  )}
                  stroke="white"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {p.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ----- particle build ------------------------------------------------------

function buildParticles(codes: Code[]): Particle[] {
  const sorted = [...codes]
    .filter((c) => c.usage_count > 0)
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, TOP_N);
  if (sorted.length === 0) return [];

  const max = Math.max(...sorted.map((c) => c.usage_count));
  const min = Math.min(...sorted.map((c) => c.usage_count));

  return sorted.map((c, i) => {
    // Log scale gives a much more readable cloud than linear when one or
    // two codes dominate — same trick used by every word-cloud library.
    const norm =
      max === min ? 1 : (Math.log(c.usage_count + 1) - Math.log(min + 1)) / (Math.log(max + 1) - Math.log(min + 1));
    const r = 18 + norm * 38;
    const angle = (i / sorted.length) * Math.PI * 2;
    const radius = 80 + Math.random() * 80;
    return {
      id: c.id,
      name: c.name,
      color: c.color || "#6366f1",
      count: c.usage_count,
      r,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
}

function buildSprings(particles: Particle[], cooc: CodeCooccurrenceRow[]): Spring[] {
  const idx = new Map(particles.map((p, i) => [p.id, i]));
  const counts = new Map(particles.map((p) => [p.id, p.count]));
  const out: Spring[] = [];
  for (const row of cooc) {
    const a = idx.get(row.code_a);
    const b = idx.get(row.code_b);
    if (a === undefined || b === undefined) continue;
    const ca = counts.get(row.code_a) ?? 1;
    const cb = counts.get(row.code_b) ?? 1;
    // Jaccard-ish — symmetric, in [0, 1].
    const j = row.occurrences / Math.max(1, ca + cb - row.occurrences);
    if (j < 0.05) continue;
    out.push({ a, b, weight: j });
  }
  return out;
}

// ----- physics -------------------------------------------------------------

function simulate(p: Particle[], springs: Spring[], steps: number): Particle[] {
  const damping = 0.78;
  const repulsionK = 380;
  const centerK = 0.012;

  for (let step = 0; step < steps; step++) {
    const t = step / steps;
    const cooling = 0.6 + 0.4 * (1 - t); // anneal velocity damping over time

    // Reset accumulators.
    for (const a of p) {
      a.vx *= damping * cooling;
      a.vy *= damping * cooling;
    }

    // Repulsion (n² but n ≤ 60 so this is < 4k ops/step).
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      for (let j = i + 1; j < p.length; j++) {
        const b = p[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = Math.max(36, dx * dx + dy * dy);
        const force = repulsionK / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Springs — pull cooccurring codes together.
    for (const s of springs) {
      const a = p[s.a];
      const b = p[s.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(0.5, Math.hypot(dx, dy));
      const target = a.r + b.r + 16; // rest distance — bubbles touch + small gap
      const k = 0.16 * s.weight;
      const f = (d - target) * k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Mild centering force so the cloud doesn't drift off-canvas.
    for (const a of p) {
      a.vx -= a.x * centerK;
      a.vy -= a.y * centerK;
    }

    // Collision pass — keep bubbles non-overlapping.
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      for (let j = i + 1; j < p.length; j++) {
        const b = p[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = a.r + b.r + 2;
        if (d < minD && d > 0.001) {
          const overlap = (minD - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }

    // Integrate.
    for (const a of p) {
      a.x += a.vx;
      a.y += a.vy;
    }
  }

  return p;
}

// Loader is unused but exported so future consumers can render their own
// loading states without re-implementing one. Keep last so the bundler can
// tree-shake when nobody imports it.
export const _ConceptCloudLoader = Loader2;
