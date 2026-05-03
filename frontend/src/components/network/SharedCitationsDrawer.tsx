import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useSharedQuotations } from "@/hooks/useCodes";
import type { CodeNetworkNode } from "@/types/database";

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codeA: CodeNetworkNode | null;
  codeB: CodeNetworkNode | null;
  weight: number;
}

export function SharedCitationsDrawer({
  projectId,
  open,
  onOpenChange,
  codeA,
  codeB,
  weight,
}: Props) {
  const { data, isLoading } = useSharedQuotations(
    projectId,
    codeA?.id ?? null,
    codeB?.id ?? null
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
            <CodePill node={codeA} />
            <span className="text-muted-foreground">↔</span>
            <CodePill node={codeB} />
          </SheetTitle>
          <SheetDescription>
            {weight} {weight === 1 ? "cita comparte" : "citas comparten"} estos dos códigos. La
            evidencia detrás de la conexión.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              Sin citas compartidas. La arista debió eliminarse después de cargar la red.
            </p>
          ) : (
            data.map((q) => (
              <article
                key={q.quotation_id}
                className="rounded-lg border bg-card p-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <Link
                    to={`/app/p/${projectId}/d/${q.document_id}?quotation=${q.quotation_id}`}
                    className="flex min-w-0 items-center gap-1.5 font-medium text-foreground hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{q.document_title}</span>
                  </Link>
                  <span>
                    {new Date(q.created_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  “{q.content}”
                </p>

                {q.comment ? (
                  <p className="mt-2 rounded bg-muted/50 px-2 py-1 text-xs italic text-muted-foreground">
                    {q.comment}
                  </p>
                ) : null}

                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-7 text-xs"
                  >
                    <Link
                      to={`/app/p/${projectId}/d/${q.document_id}?quotation=${q.quotation_id}`}
                      onClick={() => onOpenChange(false)}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Abrir en documento
                    </Link>
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CodePill({ node }: { node: CodeNetworkNode | null }) {
  if (!node) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: node.color, color: node.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: node.color }}
      />
      {node.label}
    </span>
  );
}
