import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";

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
import {
  useDocument,
  useDocumentTranscript,
  useReprocessDocument,
  useSignedDocumentUrl,
} from "@/hooks/useDocuments";
import { useDocumentQuotations } from "@/hooks/useQuotations";
import { useToast } from "@/hooks/use-toast";
import type { SelectionMeta } from "@/types/database";

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
  // Detect PDF source: any document whose storage_path ends in .pdf can
  // be viewed graphically with the new PdfDocumentViewer (F19), even if
  // it was uploaded as kind="literature" with text already extracted.
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
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-4 h-12 w-2/3" />
        <Skeleton className="mt-8 h-96" />
      </div>
    );
  }

  if (!projectId || !documentId) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to={`/app/p/${projectId}?tab=documents`}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver al proyecto
        </Link>
      </Button>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{document.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={document.status} />
            {document.word_count != null && <span>{document.word_count.toLocaleString()} palabras</span>}
            {document.page_count != null && <span>· {document.page_count} páginas</span>}
            <span>· {quotations?.length ?? 0} {quotations?.length === 1 ? "cita" : "citas"}</span>
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
          <AutoCodeButton
            documentId={documentId}
            documentReady={document.status === "ready"}
          />
        </div>
      </header>

      {document.status === "error" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
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
      )}

      {document.status === "processing" || document.status === "pending" ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm font-medium">Procesando documento…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Extrayendo texto, fragmentando e incrustando. Suele tardar unos segundos.
          </p>
        </div>
      ) : document.kind === "image" ? (
        signedUrl ? (
          <article className="rounded-xl border bg-card p-4">
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
          </article>
        ) : (
          <Skeleton className="h-96" />
        )
      ) : document.kind === "audio" ? (
        signedUrl ? (
          <article className="rounded-xl border bg-card p-4">
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
          </article>
        ) : (
          <Skeleton className="h-64" />
        )
      ) : document.kind === "video" ? (
        signedUrl ? (
          <article className="rounded-xl border bg-card p-4">
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
          </article>
        ) : (
          <Skeleton className="h-96" />
        )
      ) : isPdfSource && pdfMode ? (
        signedUrl ? (
          <article className="rounded-xl border bg-card p-4">
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
          </article>
        ) : (
          <Skeleton className="h-96" />
        )
      ) : !document.full_text ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">No hay contenido textual disponible.</p>
        </div>
      ) : (
        <article className="rounded-xl border bg-card p-6 sm:p-8">
          <DocumentTextViewer
            fullText={document.full_text}
            quotations={quotations ?? []}
            projectId={projectId}
            documentId={documentId}
            highlightQuotationId={highlightQuotationId}
          />
        </article>
      )}

      {/* Multimedia: dialog driven by parent state because the viewers
          themselves don't own a quotation form. */}
      <AddQuotationDialog
        open={!!pendingSelection}
        onOpenChange={(o) => !o && setPendingSelection(null)}
        projectId={projectId}
        documentId={documentId}
        selection={pendingSelection}
        fullText={document.full_text ?? ""}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Tip: selecciona texto y pulsa <kbd className="rounded border bg-muted px-1">I</kbd> para
        crear un código in-vivo (cita + código con el mismo texto). Usa <strong>Auto-codificar con IA</strong> para
        generar el codebook automáticamente.
      </p>
    </div>
  );
}
