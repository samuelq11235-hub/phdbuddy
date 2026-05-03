import { Plus, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocuments } from "@/hooks/useDocuments";
import { DocumentItem } from "./DocumentItem";
import { AddDocumentDialog } from "./AddDocumentDialog";

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useDocuments(projectId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Documentos</h2>
          <p className="text-sm text-muted-foreground">
            Sube fuentes para este proyecto. Cada una se extrae, fragmenta e incrusta.
          </p>
        </div>
        <AddDocumentDialog
          projectId={projectId}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Añadir documento
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="space-y-2">
          {data.map((d) => (
            <DocumentItem key={d.id} document={d} projectId={projectId} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Aún no hay documentos</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Añade entrevistas, transcripciones, notas de campo o cualquier fuente de texto que quieras analizar.
          </p>
          <AddDocumentDialog
            projectId={projectId}
            trigger={
              <Button className="mt-6">
                <Plus className="mr-2 h-4 w-4" />
                Añadir tu primer documento
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
