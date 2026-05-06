import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTextFrequency } from "@/hooks/useTextAnalysis";

interface Props { projectId: string; }

// Pure-CSS word cloud, no d3-cloud / wordcloud2.js dependency.
//
// Layout strategy: pack words inline-flex in priority order, with font
// size scaled logarithmically against the maximum count. Hue interpolated
// across the rank to give a visually balanced output. Rotated words look
// fancy in print but they hurt readability and only work with canvas;
// keeping it horizontal is the right tradeoff here.
//
// We piggyback on the existing analyze-text/frequency endpoint: the
// frequency tab and this view share the same data source; one click
// generates both views.
export function WordCloud({ projectId }: Props) {
  const mut = useTextFrequency();
  const [topN, setTopN] = useState(120);

  const items = useMemo(() => {
    if (!mut.data) return [];
    const max = mut.data.terms[0]?.count ?? 1;
    return mut.data.terms.slice(0, topN).map((t, i) => {
      // Scale font 11 → 56 px logarithmically against the max count.
      const ratio = Math.log(1 + t.count) / Math.log(1 + max);
      const size = 11 + Math.round(ratio * 45);
      // Hue cycles across a calm palette (blue → violet → magenta → cyan).
      const hue = (210 + (i * 7) % 180) % 360;
      const sat = 65;
      const light = 45 + Math.round((1 - ratio) * 15);
      return {
        term: t.term,
        count: t.count,
        size,
        color: `hsl(${hue} ${sat}% ${light}%)`,
      };
    });
  }, [mut.data, topN]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Términos a incluir</label>
          <Input
            type="number"
            min={20}
            max={500}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value) || 120)}
            className="w-32"
          />
        </div>
        <Button onClick={() => mut.mutate({ projectId, topN: 500 })} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generar
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          Tamaño proporcional a la frecuencia · stopwords ES+EN excluidas.
        </p>
      </div>
      {mut.error && (
        <p className="text-sm text-destructive">{(mut.error as Error).message}</p>
      )}
      {items.length === 0 && !mut.isPending && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm italic text-muted-foreground">
          Pulsa <strong>Generar</strong> para crear la nube a partir del texto de tus documentos.
        </div>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1.5 rounded-md border bg-muted/20 p-6 leading-none">
          {items.map((w) => (
            <span
              key={w.term}
              title={`${w.term} · ${w.count}`}
              style={{
                fontSize: `${w.size}px`,
                color: w.color,
                fontWeight: w.size > 30 ? 700 : 500,
              }}
              className="cursor-default whitespace-nowrap select-text"
            >
              {w.term}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
