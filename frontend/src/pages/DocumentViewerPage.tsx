import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, FileText, Quote as QuoteIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/documents/StatusBadge";
import { DocumentTextViewer } from "@/components/documents/DocumentTextViewer";
import { ImageDocumentViewer } from "@/components/documents/ImageDocumentViewer";
import { AudioDocumentViewer } from "@/components/documents/AudioDocumentViewer";
import { VideoDocumentViewer } from "@/components/documents/VideoDocumentViewer";
import { PdfDocumentViewer } from "@/components/documents/PdfDocumentViewer";
import { AddQuotationDialog } from "@/components/quotations/AddQuotationDialog";
import { AutoCodeButton } from "@/components/ai/AutoCodeButton";
import { DocumentSummaryButton } from "@/components/documents/DocumentSummaryButton";
import {
  useDocument,
  useDocumentTranscript,
  useReprocessDocument,
  useSignedDocumentUrl,
} from "@/hooks/useDocuments";
import { useDocumentQuotations } from "@/hooks/useQuotations";
import { useToast } from "@/hooks/use-toast";
import type { SelectionMeta } from "@/types/database";
import { cn } from "@/lib/utils";

export default function DocumentViewerPage() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>();
  const [searchParams] = useSearchParams();
  const highlightQuotationId = searchParams.get("quotation") ?? undefined;
  const { data: document, isLoading } = useDocument(documentId);
  const { data: quotations } = useDocumentQuotations(documentId);
  const { data: transcript } = useDocumentTranscript(
    document?.kind === "audio" || document?.kind === "video" ? documentId : undefined,
    { documentStatus: document?.status }
  );
  const isPdfSource =
    !!document?.storage_path && document.storage_path.toLowerCase().endsWith(".pdf");
  const [pdfMode, setPdfMode] = useState(false);

  const { data: signedUrl } = useSignedDocumentUrl(
    document?.kind === "image" ||
      document?.kind === "audio" ||
      document?.kind === "video" ||
      (isPdfSource && pdfMode)
      ? document?.storage_path ?? undefined
      : undefined
  );
  const reprocess = useReprocessDocument();
  const { toast } = useToast();

  const [pendingSelection, setPendingSelection] = useState<{
    start: number | null;
    end: number | null;
    content: string;
    meta?: SelectionMeta;
  } | null>(null);

  useEffect(() => {
    if (document) window.document.title = `${document.title} — PHDBuddy`;
    return () => {
      window.document.title = "PHDBuddy";
    };
  }, [document]);

  async function handleReprocess() {
    if (!documentId) return;
    try {
      await reprocess.mutateAsync(documentId);
      toast({ title: "Reprocesando documento" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo reprocesar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  if (isLoading || !document) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border bg-background px-5 py-3 sm:px-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-2 h-3.5 w-48" />
        </div>
        <div className="flex-1 px-6 py-8">
          <Skeleton className="h-[60vh] w-full max-w-4xl mx-auto" />
        </div>
      </div>
    );
  }

  if (!projectId || !documentId) return null;

  // Determine whether the viewer needs the bleed (full-bleed) layout.
  const needsBleed =
    document.kind === "image" ||
    document.kind === "audio" ||
    document.kind === "video" ||
    (isPdfSource && pdfMode);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Slim document header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background px-5 py-2.5 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-8 gap-1 text-muted-foreground"
        >
          <Link to={`/app/p/${projectId}?tab=documents`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Proyecto</span>
          </Link>
        </Button>
        <div className="mx-2 h-5 w-px bg-border" aria-hidden />
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-tight tracking-tight">
            {document.title}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <StatusBadge status={document.status} />
            {document.word_count != null && (
              <>
                <span aria-hidden>·</span>
                <span>{document.word_count.toLocaleString()} palabras</span>
              </>
            )}
            {document.page_count != null && (
              <>
                <span aria-hidden>·</span>
                <span>{document.page_count} páginas</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <QuoteIcon className="h-3 w-3" />
              {quotations?.length ?? 0}{" "}
              {quotations?.length === 1 ? "cita" : "citas"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPdfSource && (
            <Button
              variant={pdfMode ? "default" : "outline"}
              size="sm"
              onClick={() => setPdfMode((v) => !v)}
              title="Alterna entre la vista textual y la vista PDF con anotaciones gráficas"
            >
              {pdfMode ? "Vista texto" : "Vista PDF"}
            </Button>
          )}
          <DocumentSummaryButton
            documentId={documentId}
            documentReady={document.status === "ready"}
          />
          <AutoCodeButton
            documentId={documentId}
            documentReady={document.status === "ready"}
          />
        </div>
      </div>

      {/* Body */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          needsBleed ? "bg-surface-2" : "bg-surface-2"
        )}
      >
        {document.status === "error" ? (
          <div className="mx-auto max-w-4xl px-5 py-6 sm:px-6">
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-destructive">Falló el procesamiento</p>
                <p className="mt-1 text-sm text-destructive/80">
                  {document.error_message ?? "Ocurrió un error desconocido."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReprocess}
                disabled={reprocess.isPending}
              >
                {reprocess.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {document.status === "processing" || document.status === "pending" ? (
          <div className="mx-auto max-w-3xl px-5 py-12 text-center sm:px-6">
            <div className="rounded-xl border border-border bg-card p-12 shadow-soft">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm font-medium">Procesando documento…</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Extrayendo texto, fragmentando e incrustando. Suele tardar unos
                segundos.
              </p>
            </div>
          </div>
        ) : document.kind === "image" ? (
          signedUrl ? (
            <article className="h-full p-5 sm:p-6">
              <div className="mx-auto h-full max-w-6xl rounded-xl border border-border bg-card p-4 shadow-soft">
                <ImageDocumentViewer
                  imageUrl={signedUrl}
                  quotations={quotations ?? []}
                  onCreateRect={(bbox) =>
                    setPendingSelection({
                      start: null,
                      end: null,
                      content: `(área ${bbox.join(",")})`,
                      meta: { type: "image_area", bbox },
                    })
                  }
                />
                {document.full_text && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium">
                      Descripción y texto reconocido
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {document.full_text}
                    </p>
                  </details>
                )}
              </div>
            </article>
          ) : (
            <Skeleton className="m-6 h-96" />
          )
        ) : document.kind === "audio" ? (
          signedUrl ? (
            <article className="p-5 sm:p-6">
              <div className="mx-auto max-w-5xl rounded-xl border border-border bg-card p-4 shadow-soft">
                <AudioDocumentViewer
                  audioUrl={signedUrl}
                  segments={transcript ?? []}
                  quotations={quotations ?? []}
                  onCreateRange={(startMs, endMs, contentText) =>
                    setPendingSelection({
                      start: null,
                      end: null,
                      content: contentText,
                      meta: { type: "timerange", startMs, endMs },
                    })
                  }
                />
              </div>
            </article>
          ) : (
            <Skeleton className="m-6 h-64" />
          )
        ) : document.kind === "video" ? (
          signedUrl ? (
            <article className="p-5 sm:p-6">
              <div className="mx-auto max-w-6xl rounded-xl border border-border bg-card p-4 shadow-soft">
                <VideoDocumentViewer
                  videoUrl={signedUrl}
                  segments={transcript ?? []}
                  quotations={quotations ?? []}
                  onCreateRange={(startMs, endMs, contentText) =>
                    setPendingSelection({
                      start: null,
                      end: null,
                      content: contentText,
                      meta: { type: "timerange", startMs, endMs },
                    })
                  }
                />
              </div>
            </article>
          ) : (
            <Skeleton className="m-6 h-96" />
          )
        ) : isPdfSource && pdfMode ? (
          signedUrl ? (
            <article className="h-full p-5 sm:p-6">
              <div className="mx-auto h-full max-w-6xl rounded-xl border border-border bg-card p-4 shadow-soft">
                <PdfDocumentViewer
                  pdfUrl={signedUrl}
                  quotations={quotations ?? []}
                  onCreateRect={(bbox, page) =>
                    setPendingSelection({
                      start: null,
                      end: null,
                      content: `(área en página ${page}: ${bbox.map((n) => Math.round(n)).join(",")})`,
                      meta: { type: "image_area", bbox, page },
                    })
                  }
                />
              </div>
            </article>
          ) : (
            <Skeleton className="m-6 h-96" />
          )
        ) : !document.full_text ? (
          <div className="mx-auto max-w-3xl px-5 py-12 text-center sm:px-6">
            <div className="rounded-xl border border-border bg-card p-12 shadow-soft">
              <p className="text-sm text-muted-foreground">
                No hay contenido textual disponible.
              </p>
            </div>
          </div>
        ) : (
          <article className="px-5 py-6 sm:px-8 sm:py-10">
            <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card px-7 py-8 shadow-soft sm:px-10 sm:py-10">
              <DocumentTextViewer
                fullText={document.full_text}
                quotations={quotations ?? []}
                projectId={projectId}
                documentId={documentId}
                highlightQuotationId={highlightQuotationId}
              />
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Tip: selecciona texto y pulsa <kbd>I</kbd> para crear un código in-vivo.
              Usa <strong>Auto-codificar con IA</strong> para generar el codebook
              automáticamente.
            </p>
          </article>
        )}
      </div>

      <AddQuotationDialog
        open={!!pendingSelection}
        onOpenChange={(o) => !o && setPendingSelection(null)}
        projectId={projectId}
        documentId={documentId}
        selection={pendingSelection}
        fullText={document.full_text ?? ""}
      />
    </div>
  );
}
