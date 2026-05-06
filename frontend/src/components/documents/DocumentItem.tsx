import { Link } from "react-router-dom";
import {
  FileText,
  Mic,
  Users,
  Notebook,
  ListChecks,
  Library,
  MessageSquareText,
  MoreVertical,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  AudioWaveform,
  Video,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { useDeleteDocument, useReprocessDocument } from "@/hooks/useDocuments";
import { useToast } from "@/hooks/use-toast";
import type { Document, DocumentKind } from "@/types/database";

const ICONS: Record<DocumentKind, React.ComponentType<{ className?: string }>> = {
  interview: Mic,
  focus_group: Users,
  field_notes: Notebook,
  survey: ListChecks,
  literature: Library,
  transcript: MessageSquareText,
  other: FileText,
  image: ImageIcon,
  audio: AudioWaveform,
  video: Video,
};

const KIND_LABELS: Record<DocumentKind, string> = {
  interview: "Entrevista",
  focus_group: "Grupo focal",
  field_notes: "Notas de campo",
  survey: "Encuesta",
  literature: "Literatura",
  transcript: "Transcripción",
  other: "Documento",
  image: "Imagen",
  audio: "Audio",
  video: "Vídeo",
};

export function DocumentItem({
  document,
  projectId,
}: {
  document: Document;
  projectId: string;
}) {
  const Icon = ICONS[document.kind] ?? FileText;
  const deleteDoc = useDeleteDocument();
  const reprocess = useReprocessDocument();
  const { toast } = useToast();

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `¿Eliminar "${document.title}"? También se eliminarán sus citas y codificaciones.`
      )
    )
      return;
    try {
      await deleteDoc.mutateAsync(document);
      toast({ title: "Documento eliminado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleReprocess(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await reprocess.mutateAsync(document.id);
      toast({ title: "Reprocesamiento iniciado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el reprocesamiento",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Link
      to={`/app/p/${projectId}/d/${document.id}`}
      className="group flex items-start justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{document.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{KIND_LABELS[document.kind]}</span>
            {document.word_count != null && (
              <>
                <span>•</span>
                <span>{document.word_count.toLocaleString()} palabras</span>
              </>
            )}
            {document.quotation_count > 0 && (
              <>
                <span>•</span>
                <span>{document.quotation_count} {document.quotation_count === 1 ? "cita" : "citas"}</span>
              </>
            )}
          </div>
          {document.error_message && (
            <p className="mt-1 line-clamp-1 text-xs text-destructive">
              {document.error_message}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <StatusBadge status={document.status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.preventDefault()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleReprocess}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reprocesar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Link>
  );
}
