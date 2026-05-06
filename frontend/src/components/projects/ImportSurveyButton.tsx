import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { importSurvey } from "@/lib/api";

// CSV survey importer flow:
//   1. Pick a file (or drop one).
//   2. We parse the header row in-browser to show column checkboxes.
//   3. User picks: which columns are content, which are attributes,
//      which is the respondent ID, optional group name + new project.
//   4. Submit → server creates docs (1 per content column per row).
//
// We don't try to be too clever: ATLAS does the same wizard. The
// in-browser CSV parsing is just to get headers; the actual file is
// re-sent as-is to the server which has the canonical parser.
export function ImportSurveyButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [idColumn, setIdColumn] = useState("");
  const [contentCols, setContentCols] = useState<Set<string>>(new Set());
  const [attrCols, setAttrCols] = useState<Set<string>>(new Set());
  const [newProjectName, setNewProjectName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  function handleClick() {
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast({
        variant: "destructive",
        title: "Formato incorrecto",
        description: "Solo se aceptan archivos .csv",
      });
      return;
    }
    // Read just enough to extract headers — first KB is plenty.
    const text = await f.slice(0, 4096).text();
    const headerLine = text.split(/\r?\n/)[0] ?? "";
    const cols = parseHeaderLine(headerLine);
    if (cols.length === 0) {
      toast({ variant: "destructive", title: "CSV vacío" });
      return;
    }
    setFile(f);
    setHeaders(cols);
    setIdColumn(cols[0] ?? "");
    setContentCols(new Set());
    setAttrCols(new Set());
    setNewProjectName(f.name.replace(/\.csv$/i, ""));
    setGroupName("");
    setOpen(true);
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, col: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  async function submit() {
    if (!file) return;
    if (contentCols.size === 0) {
      toast({
        variant: "destructive",
        title: "Selecciona al menos una columna de contenido",
      });
      return;
    }
    setLoading(true);
    try {
      const resp = await importSurvey({
        file,
        newProjectName,
        mapping: {
          idColumn: idColumn || undefined,
          contentColumns: Array.from(contentCols),
          attributeColumns: Array.from(attrCols),
          groupName: groupName.trim() || undefined,
          skipEmpty: true,
        },
      });
      toast({
        title: "Encuesta importada",
        description: `${resp.documentsCreated} documentos creados desde ${resp.rowsProcessed} filas.`,
      });
      qc.invalidateQueries({ queryKey: ["projects", user?.id] });
      navigate(`/app/p/${resp.projectId}`);
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo importar",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
      <Button variant="outline" onClick={handleClick} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ClipboardList className="mr-2 h-4 w-4" />
        )}
        Importar encuesta CSV
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurar importación de encuesta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nombre del nuevo proyecto</label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Grupo de documentos (opcional)</label>
              <Input
                placeholder="ej. Encuesta piloto 2024"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Columna identificadora del respondente</label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={idColumn}
                onChange={(e) => setIdColumn(e.target.value)}
              >
                <option value="">— autoincremental —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColumnPicker
                label="Columnas de contenido (1 documento por cada una)"
                columns={headers}
                selected={contentCols}
                onToggle={(c) => toggleSet(setContentCols, c)}
              />
              <ColumnPicker
                label="Columnas de atributos (metadatos)"
                columns={headers}
                selected={attrCols}
                onToggle={(c) => toggleSet(setAttrCols, c)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={loading || contentCols.size === 0} onClick={submit}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ColumnPicker({
  label,
  columns,
  selected,
  onToggle,
}: {
  label: string;
  columns: string[];
  selected: Set<string>;
  onToggle: (c: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
        {columns.map((c) => (
          <label key={c} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={selected.has(c)}
              onChange={() => onToggle(c)}
            />
            <span className="truncate">{c}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Same parser as the server, but only used to get headers — not values.
function parseHeaderLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur || out.length) out.push(cur.trim());
  return out;
}
