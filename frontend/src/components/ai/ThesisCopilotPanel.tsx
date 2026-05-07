// F36 — Thesis Copilot.
//
// A purpose-built workspace tab that drafts each section of a
// qualitative-research thesis using the project's codebook, top
// quotations, memos, and active theoretical framework.
//
// The copilot is *grounded*: every quote it injects comes from the
// corpus, never from training data. Citations are listed alongside the
// generated text so the researcher can verify each one before
// committing to a memo of kind "theoretical".
import { useState } from "react";
import {
  BookOpen,
  ClipboardList,
  Save,
  Loader2,
  ScrollText,
  Sparkles,
  ChevronRight,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMemo } from "@/hooks/useMemos";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type SectionKind =
  | "introduction"
  | "methodology"
  | "findings"
  | "discussion"
  | "limitations";

const SECTIONS: { id: SectionKind; label: string; description: string }[] = [
  {
    id: "introduction",
    label: "Introducción",
    description: "Contexto, vacío en la literatura, pregunta y propósito.",
  },
  {
    id: "methodology",
    label: "Metodología",
    description:
      "Diseño cualitativo, marco activo, procedimiento y criterios de rigor.",
  },
  {
    id: "findings",
    label: "Hallazgos",
    description: "Temas con citas literales del corpus.",
  },
  {
    id: "discussion",
    label: "Discusión",
    description: "Interpretación integradora a la luz del marco teórico.",
  },
  {
    id: "limitations",
    label: "Limitaciones",
    description: "Alcance, sesgos y futuras líneas.",
  },
];

interface Result {
  section: string;
  content: string;
  citations: { quotationId: string; documentTitle: string; text: string }[];
}

interface Props {
  projectId: string;
}

export function ThesisCopilotPanel({ projectId }: Props) {
  const [active, setActive] = useState<SectionKind>("introduction");
  const [extraGuidance, setExtraGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const createMemo = useCreateMemo();
  const [saved, setSaved] = useState(false);

  async function generate(force = false) {
    setBusy(true);
    setError(null);
    setSaved(false);
    if (force) setResult(null);
    try {
      const r = await api.generateThesisSection({
        projectId,
        section: active,
        extraGuidance: extraGuidance.trim() || undefined,
        refresh: force,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló la generación");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsMemo() {
    if (!result) return;
    const sectionMeta = SECTIONS.find((s) => s.id === active);
    await createMemo.mutateAsync({
      projectId,
      title: `Borrador · ${sectionMeta?.label ?? active}`,
      content: result.content,
      kind: "theoretical",
    });
    setSaved(true);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Section picker */}
      <aside className="space-y-2">
        <div className="px-1 pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Secciones de la tesis
          </p>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setActive(s.id);
              setResult(null);
              setError(null);
            }}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-all hover:border-border-strong hover:shadow-soft",
              active === s.id &&
                "border-primary bg-primary/5 ring-1 ring-primary/30"
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                active === s.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {iconFor(s.id)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {s.description}
              </p>
            </div>
            {active === s.id ? (
              <ChevronRight className="ml-auto h-4 w-4 self-center text-primary" />
            ) : null}
          </button>
        ))}
      </aside>

      {/* Editor area */}
      <section className="space-y-3">
        <Card className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Copiloto de tesis · {SECTIONS.find((s) => s.id === active)?.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Genera un borrador apoyado en codebook, citas y memos. Verifica
                cada cita antes de publicar.
              </p>
            </div>
            <Button
              onClick={() => generate(!!result)}
              disabled={busy}
              className="gap-1.5"
              title={
                result
                  ? "Recomputar ignorando la caché"
                  : "Generar (devuelve caché si está fresca)"
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {result ? "Regenerar" : "Generar borrador"}
            </Button>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-muted-foreground">
              Notas del autor (opcional)
            </label>
            <Textarea
              value={extraGuidance}
              onChange={(e) => setExtraGuidance(e.target.value)}
              placeholder="Ej.: enfatiza el conflicto generacional; evita lenguaje exagerado…"
              rows={2}
            />
          </div>
        </Card>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {result ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
              <p className="text-sm font-semibold">Borrador</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(result.content)}
                >
                  Copiar Markdown
                </Button>
                <Button
                  size="sm"
                  onClick={saveAsMemo}
                  disabled={createMemo.isPending || saved}
                  className="gap-1.5"
                >
                  {createMemo.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saved ? "Guardado" : "Guardar como memo"}
                </Button>
              </div>
            </div>
            <article className="prose prose-sm dark:prose-invert max-h-[60vh] max-w-none overflow-y-auto px-5 py-4 [&_blockquote]:border-l-4 [&_blockquote]:border-violet-300 [&_blockquote]:bg-violet-50/40 dark:[&_blockquote]:bg-violet-900/10 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:italic [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold">
              <SimpleMarkdown source={result.content} />
            </article>
          </Card>
        ) : null}

        {result && result.citations.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border bg-surface-2 px-4 py-2">
              <p className="text-sm font-semibold">
                Citas verificables ({result.citations.length})
              </p>
              <p className="text-[11px] text-muted-foreground">
                Cada fragmento entre comillas en el borrador proviene de una de
                estas citas reales del corpus.
              </p>
            </div>
            <ul className="divide-y divide-border">
              {result.citations.map((c) => (
                <li key={c.quotationId} className="px-4 py-2.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {c.documentTitle}
                  </p>
                  <p className="mt-0.5 text-sm leading-snug">"{c.text}"</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function iconFor(id: SectionKind) {
  switch (id) {
    case "introduction":
      return <BookOpen className="h-3.5 w-3.5" />;
    case "methodology":
      return <ClipboardList className="h-3.5 w-3.5" />;
    case "findings":
      return <ScrollText className="h-3.5 w-3.5" />;
    case "discussion":
      return <Sparkles className="h-3.5 w-3.5" />;
    case "limitations":
      return <ChevronRight className="h-3.5 w-3.5" />;
  }
}

// Tiny markdown renderer to keep the dialog dependency-free.
// Supports headings, blockquotes, paragraphs, bold/italic — enough for
// the model output without pulling react-markdown into the bundle.
function SimpleMarkdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/g);
  return (
    <>
      {blocks.map((b, i) => {
        const trimmed = b.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("## ")) {
          return <h2 key={i}>{renderInline(trimmed.slice(3))}</h2>;
        }
        if (trimmed.startsWith("### ")) {
          return <h3 key={i}>{renderInline(trimmed.slice(4))}</h3>;
        }
        if (trimmed.startsWith("# ")) {
          return <h1 key={i}>{renderInline(trimmed.slice(2))}</h1>;
        }
        if (trimmed.startsWith("> ")) {
          const text = trimmed
            .split("\n")
            .map((l) => l.replace(/^>\s?/, ""))
            .join(" ");
          return <blockquote key={i}>{renderInline(text)}</blockquote>;
        }
        if (/^[-*]\s/.test(trimmed)) {
          const items = trimmed.split("\n").map((l) => l.replace(/^[-*]\s/, ""));
          return (
            <ul key={i}>
              {items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(trimmed)}</p>;
      })}
    </>
  );
}

function renderInline(s: string): React.ReactNode {
  // Bold (**x**) and italic (*x* / _x_).
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
