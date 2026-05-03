import { Link } from "react-router-dom";
import { Quote, Trash2, Sparkles, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeBadge } from "@/components/codes/CodeBadge";
import { useDeleteQuotation, useToggleCoding, type QuotationWithCodes } from "@/hooks/useQuotations";
import { useToast } from "@/hooks/use-toast";

interface Props {
  quotation: QuotationWithCodes;
  projectId: string;
  showDocumentLink?: boolean;
}

export function QuotationCard({ quotation, projectId, showDocumentLink = true }: Props) {
  const deleteQ = useDeleteQuotation();
  const toggleCoding = useToggleCoding();
  const { toast } = useToast();

  async function handleDelete() {
    if (!confirm("¿Eliminar esta cita?")) return;
    try {
      await deleteQ.mutateAsync(quotation);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la eliminación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <article className="group rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background:
              quotation.codes.length > 0
                ? `linear-gradient(135deg, ${quotation.codes[0].color}, ${
                    quotation.codes[Math.min(1, quotation.codes.length - 1)].color
                  })`
                : "hsl(var(--muted))",
          }}
        >
          <Quote className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="leading-relaxed text-foreground">
            <span className="text-muted-foreground">&ldquo;</span>
            {quotation.content}
            <span className="text-muted-foreground">&rdquo;</span>
          </p>

          {quotation.comment && (
            <p className="mt-2 rounded-md border-l-2 border-primary/40 bg-muted/30 px-3 py-1.5 text-sm italic text-muted-foreground">
              {quotation.comment}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {quotation.codes.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">Sin códigos asignados</span>
            ) : (
              quotation.codes.map((c) => (
                <CodeBadge
                  key={c.id}
                  code={{ ...c, created_by_ai: c.created_by_ai }}
                  showAi
                  onRemove={() =>
                    toggleCoding.mutate({
                      quotationId: quotation.id,
                      codeId: c.id,
                      attach: false,
                    })
                  }
                />
              ))
            )}
            {quotation.created_by_ai && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary">
                <Sparkles className="h-3 w-3" />
                Sugerido por IA
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {showDocumentLink && quotation.document_title && (
              <Link
                to={`/app/p/${projectId}/d/${quotation.document_id}`}
                className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
              >
                <FileText className="h-3 w-3" />
                {quotation.document_title}
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-destructive opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              onClick={handleDelete}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
