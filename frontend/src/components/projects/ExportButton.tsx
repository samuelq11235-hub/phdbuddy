import { useState } from "react";
import { Download, FileText, Table2, Loader2, FileArchive, FileCode2, FileType2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { ExportFormat } from "@/types/database";

interface Format {
  id: ExportFormat;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  ext: string;
}

const FORMATS: Format[] = [
  {
    id: "csv",
    label: "CSV",
    description: "Tabla plana de citas para Excel / Google Sheets",
    icon: Table2,
    ext: "csv",
  },
  {
    id: "markdown",
    label: "Markdown",
    description: "Informe estructurado de codebook + citas + memos",
    icon: FileText,
    ext: "md",
  },
  {
    id: "html",
    label: "HTML / PDF",
    description: "Informe navegable con índice; imprime a PDF desde el navegador",
    icon: FileCode2,
    ext: "html",
  },
  {
    id: "docx",
    label: "Word (.docx)",
    description: "Documento Word nativo (OOXML) — abre directo en Word, Pages, Google Docs, LibreOffice",
    icon: FileType2,
    ext: "doc",
  },
  {
    id: "qdaxml",
    label: "QDA-XML (.qdpx)",
    description: "Estándar REFI-QDA — importable en Atlas.ti, MAXQDA, NVivo",
    icon: FileArchive,
    ext: "qdpx",
  },
];

export function ExportButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState<ExportFormat | null>(null);
  const { toast } = useToast();

  async function handleExport(format: ExportFormat) {
    setLoading(format);
    try {
      const resp = await api.exportProject({ projectId, format });
      toast({
        title: "Exportación lista",
        description: (
          <span>
            El archivo se descargará automáticamente.{" "}
            <a
              href={resp.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Abrir manualmente
            </a>
          </span>
        ),
        duration: 10000,
      });
      // Trigger download in background.
      triggerDownload(resp.signedUrl, `phdbuddy-export-${projectId.slice(0, 8)}.${FORMATS.find((f) => f.id === format)?.ext ?? format}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al exportar",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(null);
    }
  }

  const isExporting = loading !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Formato de exportación</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map((f) => (
          <DropdownMenuItem
            key={f.id}
            onClick={() => handleExport(f.id)}
            disabled={isExporting}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="flex items-center gap-2 font-medium">
              {loading === f.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <f.icon className="h-4 w-4 text-muted-foreground" />
              )}
              {f.label}
            </span>
            <span className="pl-6 text-xs text-muted-foreground">{f.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
