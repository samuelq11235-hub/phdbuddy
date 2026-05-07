import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Quote,
  Tags,
  NotebookPen,
  Loader2,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { Document, Code, Memo, Quotation } from "@/types/database";

interface SearchHit {
  type: "document" | "code" | "memo" | "quotation";
  id: string;
  primary: string;
  secondary?: string;
  // Optional href when the hit links to a route. Codes/memos open their
  // workspace tabs via query param so the panel auto-opens.
  to: string;
  // For ranking / icon coloring.
  weight: number;
}

/**
 * Project-wide search dialog (Cmd+K / Ctrl+K). Searches:
 *   - Documents by title (ILIKE)
 *   - Codes by name OR description (ILIKE)
 *   - Memos by title OR content (ILIKE)
 *   - Quotations by content (ILIKE) — biggest table, capped at 50 rows
 *
 * We use ILIKE rather than full-text indexes here because:
 *   1. The dataset per project is small (typical ≤50K quotations).
 *   2. Adding GIN tsvector indexes would require migrations and per-
 *      language config, which is overkill for what's effectively a
 *      "find this entity by name" UX. If projects start hitting >100K
 *      quotations we revisit with a tsvector column + trigger.
 */
export function GlobalSearchDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the dialog opens. Without this the user
  // has to click the field after Cmd+K — friction we shouldn't introduce.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    setQuery("");
    setHits([]);
  }, [open]);

  // Debounced search — fires 200ms after the user stops typing so we
  // don't hammer the DB on every keystroke.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await runSearch(projectId, q);
        setHits(results);
      } catch (err) {
        console.error("[global-search] failed", err);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, projectId, open]);

  const grouped = useMemo(() => {
    const out: Record<SearchHit["type"], SearchHit[]> = {
      document: [],
      code: [],
      memo: [],
      quotation: [],
    };
    for (const h of hits) out[h.type].push(h);
    return out;
  }, [hits]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-muted-foreground" />
            Buscar en el proyecto
          </DialogTitle>
          <DialogDescription className="sr-only">
            Busca documentos, códigos, memos y citas a la vez.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-4 py-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escribe al menos 2 caracteres…"
            className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {loading && hits.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Buscando…
            </div>
          ) : query.trim().length < 2 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Empieza a escribir para buscar documentos, códigos, memos y citas.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Sin resultados para «{query}».
            </p>
          ) : (
            <div className="space-y-3">
              <Section
                title="Documentos"
                icon={FileText}
                hits={grouped.document}
                onPick={() => onOpenChange(false)}
              />
              <Section
                title="Códigos"
                icon={Tags}
                hits={grouped.code}
                onPick={() => onOpenChange(false)}
              />
              <Section
                title="Memos"
                icon={NotebookPen}
                hits={grouped.memo}
                onPick={() => onOpenChange(false)}
              />
              <Section
                title="Citas"
                icon={Quote}
                hits={grouped.quotation}
                onPick={() => onOpenChange(false)}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  icon: Icon,
  hits,
  onPick,
}: {
  title: string;
  icon: typeof FileText;
  hits: SearchHit[];
  onPick: () => void;
}) {
  if (hits.length === 0) return null;
  return (
    <section>
      <header className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </header>
      <ul>
        {hits.map((h) => (
          <li key={`${h.type}:${h.id}`}>
            <Link
              to={h.to}
              onClick={onPick}
              className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/50"
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm">{h.primary}</div>
                {h.secondary ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {h.secondary}
                  </div>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function runSearch(projectId: string, q: string): Promise<SearchHit[]> {
  // Postgres ILIKE pattern: anchor with % on both sides for substring match.
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  // Run the four queries in parallel — they're independent and cheap.
  const [docs, codes, memos, quotes] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, kind")
      .eq("project_id", projectId)
      .ilike("title", pattern)
      .limit(8),
    supabase
      .from("codes")
      .select("id, name, description, color")
      .eq("project_id", projectId)
      .or(`name.ilike.${pattern},description.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("memos")
      .select("id, title, kind")
      .eq("project_id", projectId)
      .or(`title.ilike.${pattern},content.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("quotations")
      .select("id, document_id, content, document:documents(title)")
      .eq("project_id", projectId)
      .ilike("content", pattern)
      .limit(50),
  ]);

  const out: SearchHit[] = [];

  for (const d of (docs.data ?? []) as Pick<Document, "id" | "title" | "kind">[]) {
    out.push({
      type: "document",
      id: d.id,
      primary: d.title,
      secondary: d.kind,
      to: `/projects/${projectId}/documents/${d.id}`,
      weight: 5,
    });
  }
  for (const c of (codes.data ?? []) as Pick<Code, "id" | "name" | "description">[]) {
    out.push({
      type: "code",
      id: c.id,
      primary: c.name,
      secondary: c.description ?? undefined,
      to: `/projects/${projectId}?tab=codes&codeId=${c.id}`,
      weight: 4,
    });
  }
  for (const m of (memos.data ?? []) as Pick<Memo, "id" | "title" | "kind">[]) {
    out.push({
      type: "memo",
      id: m.id,
      primary: m.title,
      secondary: m.kind,
      to: `/projects/${projectId}?tab=memos&memoId=${m.id}`,
      weight: 3,
    });
  }
  for (const row of (quotes.data ?? []) as (Pick<Quotation, "id" | "document_id" | "content"> & {
    document: { title: string } | { title: string }[] | null;
  })[]) {
    const doc = Array.isArray(row.document) ? row.document[0] : row.document;
    out.push({
      type: "quotation",
      id: row.id,
      primary: row.content.slice(0, 200),
      secondary: doc?.title,
      to: `/projects/${projectId}/documents/${row.document_id}?quotation=${row.id}`,
      weight: 2,
    });
  }

  // Cheap relevance: prefer hits where the pattern occurs near the start
  // of the primary field (typical "exact match" intent).
  const lowQ = q.toLowerCase();
  return out.sort((a, b) => {
    const aIdx = a.primary.toLowerCase().indexOf(lowQ);
    const bIdx = b.primary.toLowerCase().indexOf(lowQ);
    const aRank = aIdx < 0 ? 1e6 : aIdx;
    const bRank = bIdx < 0 ? 1e6 : bIdx;
    if (aRank !== bRank) return aRank - bRank;
    return b.weight - a.weight;
  });
}
