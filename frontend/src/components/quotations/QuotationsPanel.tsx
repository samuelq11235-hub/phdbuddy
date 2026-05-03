import { useMemo, useState } from "react";
import { Quote as QuoteIcon, Sparkles, Loader2, Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBadge } from "@/components/codes/CodeBadge";
import { QuotationCard } from "./QuotationCard";
import { useQuotations } from "@/hooks/useQuotations";
import { useCodes } from "@/hooks/useCodes";
import { useDocuments } from "@/hooks/useDocuments";
import { useClusterThemes, useThemeSuggestions } from "@/hooks/useAISuggestions";
import { useAnalyzeSentiment, useQuotationSentimentMap } from "@/hooks/useSentiment";
import { useToast } from "@/hooks/use-toast";
import type { SentimentLabel } from "@/types/database";

export function QuotationsPanel({ projectId }: { projectId: string }) {
  const [codeFilter, setCodeFilter] = useState<string>("");
  const [docFilter, setDocFilter] = useState<string>("");
  const [sentimentFilter, setSentimentFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: quotations, isLoading } = useQuotations(projectId, {
    codeId: codeFilter || undefined,
    documentId: docFilter || undefined,
  });
  const { data: codes } = useCodes(projectId);
  const { data: documents } = useDocuments(projectId);
  const { data: themes } = useThemeSuggestions(projectId);
  const cluster = useClusterThemes();
  const sentiments = useQuotationSentimentMap(projectId);
  const analyzeSentiment = useAnalyzeSentiment();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!quotations) return [];
    let list = quotations;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (qt) =>
          qt.content.toLowerCase().includes(q) ||
          (qt.comment ?? "").toLowerCase().includes(q)
      );
    }
    if (sentimentFilter) {
      if (sentimentFilter === "_unanalyzed") {
        list = list.filter((q) => !sentiments.has(q.id));
      } else {
        list = list.filter(
          (q) => sentiments.get(q.id)?.label === (sentimentFilter as SentimentLabel)
        );
      }
    }
    return list;
  }, [quotations, search, sentimentFilter, sentiments]);

  const latestThemes = themes?.[0];

  async function handleClusterThemes() {
    try {
      await cluster.mutateAsync({ projectId });
      toast({
        title: "Temas descubiertos",
        description: "Desplázate hacia abajo para revisar los clusters temáticos generados por la IA.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el descubrimiento de temas",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  // Bulk-analyze sentiment over the currently visible quotations. We split
  // into batches of 25 so we never exceed the edge function's HARD_BATCH_LIMIT
  // and the user gets incremental progress when there are hundreds of citas.
  async function handleAnalyzeSentiment() {
    const targets = filtered
      .filter((q) => !sentiments.has(q.id))
      .map((q) => q.id);
    if (targets.length === 0) {
      toast({
        title: "Nada que analizar",
        description: "Todas las citas visibles ya tienen sentimiento analizado.",
      });
      return;
    }
    const BATCH = 25;
    let analyzed = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      try {
        const res = await analyzeSentiment.mutateAsync({
          projectId,
          quotationIds: slice,
        });
        analyzed += res.analyzed;
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Falló el análisis de sentimiento",
          description: err instanceof Error ? err.message : undefined,
        });
        return;
      }
    }
    toast({
      title: "Sentimiento analizado",
      description: `${analyzed} ${analyzed === 1 ? "cita procesada" : "citas procesadas"}.`,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Citas</h2>
          <p className="text-sm text-muted-foreground">
            {quotations?.length ?? 0} {quotations?.length === 1 ? "cita" : "citas"}.
            Filtra por código o documento, o ejecuta el descubrimiento de temas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleAnalyzeSentiment}
            disabled={analyzeSentiment.isPending || (quotations?.length ?? 0) === 0}
          >
            {analyzeSentiment.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Heart className="mr-2 h-4 w-4" />
            )}
            Analizar sentimiento
          </Button>
          <Button
            onClick={handleClusterThemes}
            disabled={cluster.isPending || (quotations?.length ?? 0) < 2}
          >
            {cluster.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Descubrir temas
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          placeholder="Buscar contenido..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={codeFilter || "all"} onValueChange={(v) => setCodeFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Todos los códigos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los códigos</SelectItem>
            {codes?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={docFilter || "all"} onValueChange={(v) => setDocFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Todos los documentos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los documentos</SelectItem>
            {documents?.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sentimentFilter || "all"}
          onValueChange={(v) => setSentimentFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Cualquier sentimiento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier sentimiento</SelectItem>
            <SelectItem value="positive">Positivo</SelectItem>
            <SelectItem value="negative">Negativo</SelectItem>
            <SelectItem value="neutral">Neutro</SelectItem>
            <SelectItem value="mixed">Mixto</SelectItem>
            <SelectItem value="_unanalyzed">Sin analizar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {latestThemes?.payload?.clusters && latestThemes.payload.clusters.length > 0 && (
        <ThemesPreview clusters={latestThemes.payload.clusters} />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <QuoteIcon className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Aún no hay citas</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Abre un documento y selecciona texto para crear tu primera cita, o ejecuta la
            auto-codificación con IA en un documento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((q) => (
            <QuotationCard
              key={q.id}
              quotation={q}
              projectId={projectId}
              sentiment={sentiments.get(q.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThemesPreview({
  clusters,
}: {
  clusters: { id: string; label: string; description: string; size: number; representative_quote: string }[];
}) {
  return (
    <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-background p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Temas descubiertos por la IA</h3>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {clusters.slice(0, 6).map((c) => (
          <div key={c.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium">{c.label}</h4>
              <CodeBadge
                code={{ id: c.id, name: `${c.size} ${c.size === 1 ? "cita" : "citas"}`, color: "#7C3AED" }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
            <p className="mt-2 line-clamp-3 border-l-2 border-primary/30 bg-muted/20 px-2 py-1 text-xs italic">
              &ldquo;{c.representative_quote}&rdquo;
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
