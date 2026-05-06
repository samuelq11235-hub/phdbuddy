import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, BarChart3, Search, Network as NetworkIcon } from "lucide-react";
import { useTextFrequency, useTextKwic, useCooccurrence } from "@/hooks/useTextAnalysis";

interface Props {
  projectId: string;
}

// One panel, three subviews. State per-tab is local to each subcomponent
// so navigating away doesn't re-trigger the analysis.
export function TextAnalysisPanel({ projectId }: Props) {
  return (
    <div>
      <header className="mb-4">
        <h2 className="text-xl font-semibold">Análisis de texto</h2>
        <p className="text-sm text-muted-foreground">
          Frecuencias de palabras, búsquedas en contexto (KWIC) y matriz de co-ocurrencia entre códigos.
        </p>
      </header>
      <Tabs defaultValue="frequency">
        <TabsList>
          <TabsTrigger value="frequency"><BarChart3 className="mr-1.5 h-4 w-4" />Frecuencias</TabsTrigger>
          <TabsTrigger value="kwic"><Search className="mr-1.5 h-4 w-4" />KWIC</TabsTrigger>
          <TabsTrigger value="cooc"><NetworkIcon className="mr-1.5 h-4 w-4" />Co-ocurrencia</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="frequency"><FrequencyTab projectId={projectId} /></TabsContent>
          <TabsContent value="kwic"><KwicTab projectId={projectId} /></TabsContent>
          <TabsContent value="cooc"><CooccurrenceTab projectId={projectId} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ----------------- Frequency ----------------

function FrequencyTab({ projectId }: { projectId: string }) {
  const mut = useTextFrequency();
  const data = mut.data;
  const [topN, setTopN] = useState(100);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Top N términos</label>
          <Input
            type="number"
            min={10}
            max={500}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value) || 100)}
            className="w-32"
          />
        </div>
        <Button onClick={() => mut.mutate({ projectId, topN })} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Calcular
        </Button>
      </div>
      {mut.isPending && <Skeleton className="mt-4 h-64" />}
      {mut.error && <p className="mt-3 text-sm text-destructive">{(mut.error as Error).message}</p>}
      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Tokens totales" value={data.totalTokens.toLocaleString("es-ES")} />
            <Stat label="Términos únicos" value={data.uniqueTerms.toLocaleString("es-ES")} />
            <Stat label="Documentos" value={data.documentsAnalyzed} />
            <Stat label="Top mostrados" value={data.terms.length} />
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Término</th>
                  <th className="px-3 py-2 text-right">Frecuencia</th>
                  <th className="px-3 py-2 text-right">Documentos</th>
                </tr>
              </thead>
              <tbody>
                {data.terms.map((t) => (
                  <tr key={t.term} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{t.term}</td>
                    <td className="px-3 py-1.5 text-right">{t.count}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{t.documentFrequency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ----------------- KWIC ----------------

function KwicTab({ projectId }: { projectId: string }) {
  const mut = useTextKwic();
  const [term, setTerm] = useState("");
  const [context, setContext] = useState(60);
  const [caseSensitive, setCaseSensitive] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-muted-foreground">Término</label>
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ej. estrés" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Contexto (chars)</label>
          <Input
            type="number"
            min={10}
            max={300}
            value={context}
            onChange={(e) => setContext(Number(e.target.value) || 60)}
            className="w-28"
          />
        </div>
        <label className="mb-1 flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Distinguir mayúsculas
        </label>
        <Button
          onClick={() => term.trim() && mut.mutate({ projectId, term, context, caseSensitive })}
          disabled={mut.isPending || !term.trim()}
        >
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Buscar
        </Button>
      </div>
      {mut.error && <p className="mt-3 text-sm text-destructive">{(mut.error as Error).message}</p>}
      {mut.data && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {mut.data.matches.length} coincidencia{mut.data.matches.length !== 1 ? "s" : ""}
            {mut.data.capped && " (recortado a 500)"}.
          </p>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-md border bg-card p-2 font-mono text-xs">
            {mut.data.matches.map((m, i) => (
              <div key={i} className="border-b py-1 last:border-0">
                <span className="text-muted-foreground">{m.left}</span>
                <strong className="bg-yellow-200/70 px-0.5 dark:bg-yellow-700/40">{m.match}</strong>
                <span className="text-muted-foreground">{m.right}</span>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {m.documentTitle} · offset {m.offset}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ----------------- Co-occurrence ----------------

function CooccurrenceTab({ projectId }: { projectId: string }) {
  const mut = useCooccurrence();
  const [scope, setScope] = useState<"quotation" | "document">("quotation");

  const codeNameById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    if (mut.data) for (const c of mut.data.codes) m.set(c.id, { name: c.name, color: c.color });
    return m;
  }, [mut.data]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Ámbito</label>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as "quotation" | "document")}
          >
            <option value="quotation">Misma cita (estricto)</option>
            <option value="document">Mismo documento (laxo)</option>
          </select>
        </div>
        <Button onClick={() => mut.mutate({ projectId, scope })} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Calcular
        </Button>
      </div>
      {mut.error && <p className="mt-3 text-sm text-destructive">{(mut.error as Error).message}</p>}
      {mut.data && (
        <div className="mt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            {mut.data.matrix.length} pares co-ocurrentes (ordenados por frecuencia descendente).
          </p>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Código A</th>
                  <th className="px-3 py-2 text-left">Código B</th>
                  <th className="px-3 py-2 text-right">Co-ocurrencias</th>
                </tr>
              </thead>
              <tbody>
                {mut.data.matrix.slice(0, 200).map((row, i) => {
                  const a = codeNameById.get(row.a);
                  const b = codeNameById.get(row.b);
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        <CodeChip name={a?.name ?? row.a} color={a?.color} />
                      </td>
                      <td className="px-3 py-1.5">
                        <CodeChip name={b?.name ?? row.b} color={b?.color} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold">{row.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function CodeChip({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {name}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
