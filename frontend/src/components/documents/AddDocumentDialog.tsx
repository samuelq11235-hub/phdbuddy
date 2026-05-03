import { useCallback, useState, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { Loader2, Upload as UploadIcon, Type, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUploadDocument, useCreateInlineDocument } from "@/hooks/useDocuments";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DocumentKind } from "@/types/database";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const KIND_OPTIONS: { value: DocumentKind; label: string }[] = [
  { value: "interview", label: "Entrevista" },
  { value: "focus_group", label: "Grupo focal" },
  { value: "transcript", label: "Transcripción" },
  { value: "field_notes", label: "Notas de campo" },
  { value: "survey", label: "Encuesta de respuesta abierta" },
  { value: "literature", label: "Literatura" },
  { value: "other", label: "Otro" },
];

export function AddDocumentDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>("interview");
  const [title, setTitle] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inlineText, setInlineText] = useState("");

  const upload = useUploadDocument();
  const inlineCreate = useCreateInlineDocument();
  const { toast } = useToast();

  const onDrop = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setPendingFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    },
    [title]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/plain": [".txt", ".md"],
    },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
    disabled: upload.isPending,
  });

  function reset() {
    setKind("interview");
    setTitle("");
    setPendingFile(null);
    setInlineText("");
  }

  async function handleFileSubmit() {
    if (!pendingFile) return;
    try {
      await upload.mutateAsync({ projectId, file: pendingFile, title, kind });
      toast({ title: "Documento subido", description: "Procesando en segundo plano." });
      setOpen(false);
      reset();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la subida",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleInlineSubmit() {
    if (!title.trim() || !inlineText.trim()) return;
    try {
      await inlineCreate.mutateAsync({ projectId, title, text: inlineText, kind });
      toast({ title: "Documento creado", description: "Procesando en segundo plano." });
      setOpen(false);
      reset();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el documento",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const busy = upload.isPending || inlineCreate.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button>Añadir documento</Button>}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Añadir un documento</DialogTitle>
          <DialogDescription>
            Sube un PDF o pega una transcripción directamente. PHDBuddy extraerá,
            fragmentará e incrustará el texto para que puedas codificarlo y conversar con él.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Título</Label>
            <Input
              id="doc-title"
              placeholder="p. ej., Entrevista 03 — María"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs defaultValue="upload" className="mt-2">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="upload">
              <UploadIcon className="mr-2 h-4 w-4" />
              Subir archivo
            </TabsTrigger>
            <TabsTrigger value="paste">
              <Type className="mr-2 h-4 w-4" />
              Pegar texto
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <div
              {...getRootProps()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
                busy && "pointer-events-none opacity-60"
              )}
            >
              <input {...getInputProps()} />
              {pendingFile ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">{pendingFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(pendingFile.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <UploadIcon className="mb-3 h-8 w-8 text-primary" />
                  <p className="text-sm font-medium">
                    {isDragActive ? "Suelta aquí" : "Suelta un PDF, TXT o MD aquí, o haz clic para seleccionarlo"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Hasta 50 MB</p>
                </>
              )}
            </div>

            {fileRejections.length > 0 && (
              <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {fileRejections[0].errors[0].message}
              </div>
            )}

            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button variant="ghost" type="button">
                  Cancelar
                </Button>
              </DialogClose>
              <Button onClick={handleFileSubmit} disabled={!pendingFile || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Subir y procesar
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="paste" className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inline-text">Transcripción</Label>
              <Textarea
                id="inline-text"
                placeholder="Pega aquí tu transcripción o texto..."
                value={inlineText}
                onChange={(e) => setInlineText(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {inlineText.split(/\s+/).filter(Boolean).length.toLocaleString()} palabras
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" type="button">Cancelar</Button>
              </DialogClose>
              <Button
                onClick={handleInlineSubmit}
                disabled={!title.trim() || !inlineText.trim() || busy}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Crear y procesar
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
