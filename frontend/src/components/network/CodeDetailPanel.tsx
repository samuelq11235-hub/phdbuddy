import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCodes, useDocumentsForCode } from "@/hooks/useCodes";
import type { CodeNetworkNode } from "@/types/database";

interface Props {
  projectId: string;
  node: CodeNetworkNode | null;
  onClose: () => void;
}

export function CodeDetailPanel({ projectId, node, onClose }: Props) {
  const { data: codes = [] } = useCodes(projectId);
  const { data: documents, isLoading: docsLoading } = useDocumentsForCode(
    projectId,
    node?.id ?? null
  );

  // "Subcódigos" = direct children of this code in the codes hierarchy.
  // We don't have a separate `subcodes` table — parent_id models the
  // same idea, and the rest of the app already treats it that way.
  const subcodes = useMemo(() => {
    if (!node) return [];
    return codes
      .filter((c) => c.parent_id === node.id)
      .sort((a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name));
  }, [codes, node]);

  if (!node) return null;

  return (
    <aside className="flex h-full max-h-[600px] flex-col overflow-hidden rounded-xl border bg-card">
      <header
        className="flex items-start justify-between gap-2 border-b px-4 py-3"
        style={{ borderTopColor: node.color, borderTopWidth: 3 }}
      >
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: node.color }}
            />
            <span className="truncate">{node.label}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {node.size} {node.size === 1 ? "uso total" : "usos totales"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Section title="Subcódigos relacionados">
          {subcodes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Este código no tiene subcódigos. Crea uno desde el codebook usando{" "}
              <span className="font-medium text-foreground">{node.label}</span> como padre.
            </p>
          ) : (
            <ul className="space-y-1">
              {subcodes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                  style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}
                >
                  <span className="min-w-0 truncate" title={c.description ?? c.name}>
                    {c.name}
                  </span>
                  <span className="text-muted-foreground">
                    {c.usage_count} {c.usage_count === 1 ? "uso" : "usos"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Documentos relacionados">
          {docsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !documents || documents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aún no hay citas en documentos para este código.
            </p>
          ) : (
            <ul className="space-y-1">
              {documents.map((d) => (
                <li key={d.document_id}>
                  <Link
                    to={`/app/p/${projectId}/d/${d.document_id}`}
                    className="group flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate">{d.document_title}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span>
                        {d.quotation_count}{" "}
                        {d.quotation_count === 1 ? "cita" : "citas"}
                      </span>
                      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}
