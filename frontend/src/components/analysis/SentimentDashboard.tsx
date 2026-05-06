import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { sentimentColor, sentimentLabelEs } from "@/hooks/useSentiment";
import type { QuotationSentiment, SentimentLabel, Code, Document } from "@/types/database";

interface Props { projectId: string; }

// Aggregated dashboard for sentiment-coded quotations:
//   - global pie / counts per label
//   - top emotions (text array)
//   - per-code breakdown (which codes correlate with positive/negative)
//   - per-document breakdown
//
// All maths runs in JS — datasets are small (a few thousand quotations
// at most). Pulling is one query per source table; we then join in
// memory.
export function SentimentDashboard({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["sentiment-dashboard", projectId],
    queryFn: async () => {
      const [{ data: sents }, { data: codes }, { data: docs }, { data: qcRowsRaw }, { data: quotas }] =
        await Promise.all([
          supabase
            .from("quotation_sentiment")
            .select("quotation_id, polarity, label, emotions")
            .eq("project_id", projectId),
          supabase
            .from("codes")
            .select("id, name, color")
            .eq("project_id", projectId),
          supabase
            .from("documents")
            .select("id, title, kind")
            .eq("project_id", projectId),
          supabase.from("quotation_codes").select("quotation_id, code_id"),
          supabase
            .from("quotations")
            .select("id, document_id")
            .eq("project_id", projectId),
        ]);
      const quotaRows = (quotas ?? []) as Array<{ id: string; document_id: string }>;
      const allowedQuotaIds = new Set(quotaRows.map((q) => q.id));
      // Filter junction by this project's quotation IDs (no project_id col).
      const qcRows = ((qcRowsRaw ?? []) as Array<{ quotation_id: string; code_id: string }>).filter(
        (r) => allowedQuotaIds.has(r.quotation_id)
      );
      return {
        sentiments: (sents ?? []) as QuotationSentiment[],
        codes: (codes ?? []) as Pick<Code, "id" | "name" | "color">[],
        documents: (docs ?? []) as Pick<Document, "id" | "title" | "kind">[],
        qc: qcRows,
        quotas: quotaRows,
      };
    },
    enabled: !!projectId,
  });

  const aggregated = useMemo(() => {
    if (!data) return null;
    const { sentiments, codes, documents, qc, quotas } = data;

    const labelCounts: Record<string, number> = {};
    let polaritySum = 0;
    const emotionCounts = new Map<string, number>();
    const sentByQuota = new Map<string, QuotationSentiment>();
    for (const s of sentiments) {
      labelCounts[s.label] = (labelCounts[s.label] ?? 0) + 1;
      polaritySum += Number(s.polarity);
      sentByQuota.set(s.quotation_id, s);
      for (const em of s.emotions ?? []) {
        emotionCounts.set(em, (emotionCounts.get(em) ?? 0) + 1);
      }
    }
    const totalSentimented = sentiments.length;

    // Per code: count sentiment buckets among quotations carrying that code.
    type Tally = { positive: number; negative: number; neutral: number; mixed: number; total: number };
    const emptyTally = (): Tally => ({ positive: 0, negative: 0, neutral: 0, mixed: 0, total: 0 });
    const byCode = new Map<string, Tally>();
    const codingsByQuota = new Map<string, string[]>();
    for (const r of qc) {
      const arr = codingsByQuota.get(r.quotation_id) ?? [];
      arr.push(r.code_id);
      codingsByQuota.set(r.quotation_id, arr);
    }
    for (const [qid, codeIds] of codingsByQuota) {
      const s = sentByQuota.get(qid);
      if (!s) continue;
      for (const cid of codeIds) {
        const t = byCode.get(cid) ?? emptyTally();
        t.total++;
        (t as Tally)[s.label as keyof Tally]++;
        byCode.set(cid, t);
      }
    }

    const codeRows = codes
      .map((c) => ({ code: c, tally: byCode.get(c.id) ?? emptyTally() }))
      .filter((r) => r.tally.total > 0)
      .sort((a, b) => b.tally.total - a.tally.total);

    const byDoc = new Map<string, Tally>();
    const quotaToDoc = new Map(quotas.map((q) => [q.id, q.document_id]));
    for (const s of sentiments) {
      const docId = quotaToDoc.get(s.quotation_id);
      if (!docId) continue;
      const t = byDoc.get(docId) ?? emptyTally();
      t.total++;
      (t as Tally)[s.label as keyof Tally]++;
      byDoc.set(docId, t);
    }
    const docRows = documents
      .map((d) => ({ doc: d, tally: byDoc.get(d.id) ?? emptyTally() }))
      .filter((r) => r.tally.total > 0)
      .sort((a, b) => b.tally.total - a.tally.total);

    const topEmotions = Array.from(emotionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    return {
      totalSentimented,
      averagePolarity: totalSentimented > 0 ? polaritySum / totalSentimented : 0,
      labelCounts,
      topEmotions,
      codeRows,
      docRows,
    };
  }, [data]);

  if (isLoading) return <Skeleton className="h-64" />;
  if (!aggregated || aggregated.totalSentimented === 0) {
    return (
      <Card className="p-6 text-sm italic text-muted-foreground">
        Aún no hay citas analizadas con sentimiento. Ve a una cita y usa "Analizar sentimiento" o ejecuta el análisis masivo.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Sentimiento agregado</h2>
        <p className="text-sm text-muted-foreground">
          Distribución del sentimiento de las citas analizadas, top emociones y desglose por código y documento.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Distribución</h3>
          <SentimentBar counts={aggregated.labelCounts} total={aggregated.totalSentimented} />
          <div className="mt-3 flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">Polaridad media:</span>
            <span className="font-mono font-semibold">{aggregated.averagePolarity.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">(rango -1 a 1)</span>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Top emociones</h3>
          {aggregated.topEmotions.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">Sin emociones específicas detectadas.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {aggregated.topEmotions.map(([em, n]) => (
                <span
                  key={em}
                  className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                >
                  {em} <span className="text-muted-foreground">·{n}</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Por código (top 30)
        </h3>
        <BreakdownTable rows={aggregated.codeRows.slice(0, 30).map((r) => ({
          key: r.code.id,
          name: r.code.name,
          color: r.code.color,
          tally: r.tally,
        }))} />
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Por documento (top 30)
        </h3>
        <BreakdownTable rows={aggregated.docRows.slice(0, 30).map((r) => ({
          key: r.doc.id,
          name: r.doc.title,
          color: undefined,
          tally: r.tally,
        }))} />
      </Card>
    </div>
  );
}

function SentimentBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const labels: SentimentLabel[] = ["positive", "neutral", "mixed", "negative"];
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-md border">
        {labels.map((l) => {
          const n = counts[l] ?? 0;
          if (n === 0) return null;
          const pct = (n / total) * 100;
          return (
            <div
              key={l}
              style={{ width: `${pct}%`, backgroundColor: sentimentColor(l) }}
              title={`${sentimentLabelEs(l)} · ${n} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {labels.map((l) => {
          const n = counts[l] ?? 0;
          return (
            <span key={l} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: sentimentColor(l) }}
              />
              {sentimentLabelEs(l)}: <strong>{n}</strong>
            </span>
          );
        })}
        <span className="ml-auto text-muted-foreground">total: {total}</span>
      </div>
    </div>
  );
}

function BreakdownTable({
  rows,
}: {
  rows: Array<{
    key: string;
    name: string;
    color: string | undefined;
    tally: { positive: number; negative: number; neutral: number; mixed: number; total: number };
  }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm italic text-muted-foreground">Sin datos.</p>;
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase">
          <tr>
            <th className="px-3 py-1.5 text-left">Nombre</th>
            <th className="px-3 py-1.5 text-right" title="Positivas">+</th>
            <th className="px-3 py-1.5 text-right" title="Neutrales">N</th>
            <th className="px-3 py-1.5 text-right" title="Mixtas">M</th>
            <th className="px-3 py-1.5 text-right" title="Negativas">−</th>
            <th className="px-3 py-1.5 text-right">Total</th>
            <th className="px-3 py-1.5 text-left">Distribución</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-1.5">
                {r.color && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: r.color }}
                  />
                )}
                {r.name}
              </td>
              <td className="px-3 py-1.5 text-right text-emerald-700 dark:text-emerald-400">{r.tally.positive}</td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">{r.tally.neutral}</td>
              <td className="px-3 py-1.5 text-right text-amber-700 dark:text-amber-400">{r.tally.mixed}</td>
              <td className="px-3 py-1.5 text-right text-rose-700 dark:text-rose-400">{r.tally.negative}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{r.tally.total}</td>
              <td className="px-3 py-1.5">
                <SentimentBar counts={r.tally} total={r.tally.total} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
