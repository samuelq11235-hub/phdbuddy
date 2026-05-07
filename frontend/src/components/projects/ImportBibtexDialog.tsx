import { useState, type ReactNode } from "react";
import { BookMarked, Loader2, Upload } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { bibEntryFullText, bibEntryTitle, parseBibtex } from "@/lib/bibtex";

/**
 * Importer for BibTeX / Zotero `.bib` exports. Each parsed entry
 * becomes a document with kind="literature" — the BibTeX fields land
 * in source_metadata so the user can later filter / cross-tab on
 * journal, year, author, etc.
 *
 * No PDFs are imported. Users who want the full text of a paper can
 * upload it separately and we'll match by DOI/title in a follow-up
 * (out of scope for now).
 */
export function ImportBibtexDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: ReactNode;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function handleFile(file: File) {
    file.text().then((t) => setText(t));
  }

  async function handleImport() {
    if (!user) return;
    const entries = parseBibtex(text);
    if (entries.length === 0) {
      toast({
        variant: "destructive",
        title: "Sin entradas",
        description: "No se ha podido extraer ninguna referencia del texto pegado.",
      });
      return;
    }
    setBusy(true);
    try {
      const rows = entries.map((entry) => ({
        user_id: user.id,
        project_id: projectId,
        title: bibEntryTitle(entry),
        kind: "literature" as const,
        full_text: bibEntryFullText(entry),
        source_metadata: {
          bibtex: {
            type: entry.type,
            citationKey: entry.citationKey,
            fields: entry.fields,
            raw: entry.raw,
          },
          // Promote the high-signal fields to the top level so they
          // can be used as document attributes for cross-tabs without
          // a UI to remap them.
          author: entry.fields.author ?? null,
          year: entry.fields.year ?? entry.fields.date ?? null,
          journal: entry.fields.journal ?? null,
          doi: entry.fields.doi ?? null,
        },
        status: "ready" as const,
      }));

      // Insert in chunks to stay under PostgREST limits on big libraries.
      const CHUNK = 100;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabase.from("documents").insert(slice);
        if (error) throw error;
        inserted += slice.length;
      }

      toast({
        title: "Bibliografía importada",
        description: `${inserted} referencia${inserted === 1 ? "" : "s"} añadida${inserted === 1 ? "" : "s"} como documentos de tipo literatura.`,
      });
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setOpen(false);
      setText("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la importación",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  // Lightweight pre-parse for the preview banner — avoid running on
  // every keystroke for huge libraries.
  const previewCount =
    text.length > 0 && text.length < 200_000 ? parseBibtex(text).length : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4" />
            Importar bibliografía (BibTeX / Zotero)
          </DialogTitle>
          <DialogDescription>
            Pega el contenido de un archivo <code className="rounded bg-muted px-1">.bib</code>{" "}
            exportado desde Zotero, Mendeley o cualquier gestor BibTeX. Cada entrada se
            convierte en un documento de tipo <em>literatura</em> con sus metadatos.
          </DialogDescription>
        </DialogHeader>

        <div>
          <input
            type="file"
            accept=".bib,.bibtex,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground file:hover:bg-primary/90"
          />
        </div>

        <Textarea
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="@article{smith2024,
  author = {Smith, J.},
  title = {Example paper},
  journal = {Journal of Stuff},
  year = {2024},
  abstract = {…}
}"
          className="font-mono text-xs"
        />

        {previewCount !== null && previewCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Detectadas <b>{previewCount}</b> entradas. Se importarán como documentos.
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={handleImport} disabled={busy || text.trim().length === 0}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
