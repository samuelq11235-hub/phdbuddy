// F33 — Theoretical saturation curve.
//
// Plots cumulative *unique codes* against the order in which documents
// were coded. The curve shows when a corpus stops yielding new
// distinctions (ATLAS.ti calls this "saturación teórica" — the moment
// adding more interviews no longer expands the codebook).
//
// We mark a heuristic plateau when the rolling slope (3-doc window)
// drops below 5% of the initial slope — this is *not* a substitute for
// theoretical judgment but a useful signal during data collection.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Sparkles } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface QuotationRow {
  code_id: string | null;
  document_id: string;
}

interface DocumentRow {
  id: string;
  title: string;
  created_at: string;
}

interface CurvePoint {
  index: number;
  documentId: string;
  documentTitle: string;
  newCodes: number;
  cumulativeCodes: number;
  shortLabel: string;
}

interface Props {
  projectId: string;
}

export function SaturationCurve({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["saturation-curve", projectId],
    queryFn: async () => {
      // Pull docs ordered by creation date and the projection of every
      // (document, code) pair. We compute the curve client-side because
      // it's tiny (≤ a few thousand rows) and avoids a custom RPC.
      const [{ data: docs, error: dErr }, { data: quotes, error: qErr }] =
        await Promise.all([
          supabase
            .from("documents")
            .select("id, title, created_at")
            .eq("project_id", projectId)
            .order("created_at", { ascending: true }),
          supabase
            .from("quotations")
            .select("code_id, document_id")
            .eq("project_id", projectId)
            .not("code_id", "is", null),
        ]);
      if (dErr) throw dErr;
      if (qErr) throw qErr;
      return {
        documents: (docs ?? []) as DocumentRow[],
        quotations: (quotes ?? []) as QuotationRow[],
      };
    },
  });

  const curve = useMemo<CurvePoint[]>(() => {
    if (!data) return [];
    const codesByDoc = new Map<string, Set<string>>();
    for (const q of data.quotations) {
      if (!q.code_id) continue;
      const s = codesByDoc.get(q.document_id) ?? new Set<string>();
      s.add(q.code_id);
      codesByDoc.set(q.document_id, s);
    }
    const seen = new Set<string>();
    const points: CurvePoint[] = [];
    let i = 0;
    for (const doc of data.documents) {
      const codes = codesByDoc.get(doc.id);
      if (!codes || codes.size === 0) continue;
      let added = 0;
      for (const c of codes) {
        if (!seen.has(c)) {
          seen.add(c);
          added += 1;
        }
      }
      i += 1;
      points.push({
        index: i,
        documentId: doc.id,
        documentTitle: doc.title,
        newCodes: added,
        cumulativeCodes: seen.size,
        shortLabel: `D${i}`,
      });
    }
    return points;
  }, [data]);

  const saturationIndex = useMemo<number | null>(() => {
    if (curve.length < 5) return null;
    const initialSlope = curve[2].cumulativeCodes / 3;
    if (initialSlope <= 0) return null;
    const threshold = Math.max(0.05 * initialSlope, 0.5);
    for (let i = 3; i < curve.length - 2; i += 1) {
      const window = curve.slice(i, i + 3);
      const slope = window.reduce((a, b) => a + b.newCodes, 0) / 3;
      if (slope < threshold) return curve[i].index;
    }
    return null;
  }, [curve]);

  if (isLoading) {
    return <Skeleton className="h-[420px] w-full" />;
  }

  if (curve.length === 0) {
    return (
      <Card className="flex h-[420px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-6 w-6 text-muted-foreground/60" />
        <p>Codifica al menos un documento para ver la curva de saturación.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Documentos codificados"
          value={curve.length.toString()}
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
        />
        <Stat
          label="Códigos únicos"
          value={curve[curve.length - 1]?.cumulativeCodes.toString() ?? "0"}
          icon={<Sparkles className="h-4 w-4 text-violet-500" />}
        />
        <Stat
          label="Saturación detectada"
          value={
            saturationIndex !== null
              ? `Doc ${saturationIndex}`
              : curve.length < 5
              ? "Más datos"
              : "Aún no"
          }
          icon={<TrendingDown className="h-4 w-4 text-amber-500" />}
          accent={saturationIndex !== null}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Curva de saturación teórica
          </p>
          <p className="text-xs text-muted-foreground">
            Códigos únicos acumulados a medida que se incorporan documentos.
            La línea naranja marca el punto en que la pendiente cae por
            debajo del 5% de la inicial.
          </p>
        </div>
        <CurveChart points={curve} saturationIndex={saturationIndex} />
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        accent && "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10"
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-base font-semibold">{value}</p>
      </div>
    </Card>
  );
}

function CurveChart({
  points,
  saturationIndex,
}: {
  points: CurvePoint[];
  saturationIndex: number | null;
}) {
  // Render the curve in a fixed-aspect SVG with margins so the labels
  // never collide with the line. This keeps it dependency-free.
  const W = 720;
  const H = 320;
  const M = { top: 16, right: 16, bottom: 36, left: 40 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const maxX = Math.max(points.length, 1);
  const maxY = Math.max(...points.map((p) => p.cumulativeCodes), 1);

  const xScale = (i: number) => M.left + (i / maxX) * innerW;
  const yScale = (v: number) => M.top + innerH - (v / maxY) * innerH;

  const path = points
    .map((p, i) => {
      const x = xScale(p.index);
      const y = yScale(p.cumulativeCodes);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const area = path + ` L ${xScale(points[points.length - 1].index)} ${
    M.top + innerH
  } L ${xScale(points[0].index)} ${M.top + innerH} Z`;

  const xTicks = niceTicks(0, maxX, 6);
  const yTicks = niceTicks(0, maxY, 5);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block min-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="satFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(262 83% 58%)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(262 83% 58%)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="currentColor"
              className="text-border"
              strokeDasharray="2 4"
            />
            <text
              x={M.left - 6}
              y={yScale(t) + 3}
              className="fill-muted-foreground text-[10px]"
              textAnchor="end"
            >
              {t}
            </text>
          </g>
        ))}

        {xTicks.map((t) =>
          t === 0 ? null : (
            <text
              key={`x-${t}`}
              x={xScale(t)}
              y={M.top + innerH + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              D{t}
            </text>
          )
        )}

        {saturationIndex !== null ? (
          <g>
            <line
              x1={xScale(saturationIndex)}
              x2={xScale(saturationIndex)}
              y1={M.top}
              y2={M.top + innerH}
              stroke="hsl(35 92% 55%)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
            />
            <rect
              x={xScale(saturationIndex) - 38}
              y={M.top + 4}
              width={76}
              height={16}
              rx={4}
              fill="hsl(35 92% 55%)"
            />
            <text
              x={xScale(saturationIndex)}
              y={M.top + 15}
              textAnchor="middle"
              className="fill-white text-[10px] font-semibold"
            >
              Plateau D{saturationIndex}
            </text>
          </g>
        ) : null}

        <path d={area} fill="url(#satFill)" />
        <path
          d={path}
          fill="none"
          stroke="hsl(262 83% 58%)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p) => (
          <g key={p.documentId}>
            <circle
              cx={xScale(p.index)}
              cy={yScale(p.cumulativeCodes)}
              r={3}
              fill="white"
              stroke="hsl(262 83% 58%)"
              strokeWidth={1.5}
            >
              <title>
                {`${p.shortLabel} · ${p.documentTitle}\n+${p.newCodes} código(s) nuevos · acumulado ${p.cumulativeCodes}`}
              </title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

// Round-friendly tick generator (Wilkinson-lite). Good enough for the
// scales we deal with (typically ≤ 100 docs and ≤ 200 codes).
function niceTicks(min: number, max: number, count: number): number[] {
  const span = Math.max(1, max - min);
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (count / span) * step;
  const niceStep =
    err <= 0.15 ? step * 10 : err <= 0.35 ? step * 5 : err <= 0.75 ? step * 2 : step;
  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;
  for (let v = start; v <= max + 0.0001; v += niceStep) {
    ticks.push(Math.round(v));
  }
  return ticks;
}
