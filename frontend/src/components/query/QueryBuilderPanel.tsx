import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Save, Tags, Wand2, FileText, Smile, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCodes } from "@/hooks/useCodes";
import { useDocuments } from "@/hooks/useDocuments";
import {
  useApplyResultsAsCode,
  useCreateSmartCode,
  useDeleteSavedQuery,
  useExecuteQuery,
  useSaveQuery,
  useSavedQueries,
} from "@/hooks/useQueries";
import type { QueryNode, SavedQuery } from "@/types/database";

// Visual builder for boolean queries over a project's quotations.
//
// Shape: a recursive AST. Top level is implicitly an AND/OR. Each leaf
// pulls a set of quotation ids; operators combine them.
//
// Why NOT React Flow / a formal AST editor? Most use cases are 1–3 levels
// deep with at most a handful of leaves. A nested list with [+] / [×]
// buttons stays readable and is much faster to learn for non-technical
// researchers than a node graph.

interface Props {
  projectId: string;
}

const EMPTY_AND: QueryNode = { op: "and", children: [] };

export function QueryBuilderPanel({ projectId }: Props) {
  const { data: codes } = useCodes(projectId);
  const { data: documents } = useDocuments(projectId);
  const { data: savedQueries } = useSavedQueries(projectId);
  const exec = useExecuteQuery();
  const save = useSaveQuery();
  const del = useDeleteSavedQuery();
  const applyAsCode = useApplyResultsAsCode();
  const smart = useCreateSmartCode();
  const { toast } = useToast();

  const [tree, setTree] = useState<QueryNode>(EMPTY_AND);
  const [savedName, setSavedName] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const codeMap = useMemo(
    () => new Map((codes ?? []).map((c) => [c.id, c])),
    [codes]
  );
  const docMap = useMemo(
    () => new Map((documents ?? []).map((d) => [d.id, d])),
    [documents]
  );

  function loadSaved(q: SavedQuery) {
    setTree(q.definition);
    setSavedName(q.name);
    setSavedId(q.id);
    exec.reset();
  }

  async function runQuery() {
    if (!isExecutable(tree)) {
      toast({
        title: "La consulta está vacía",
        description: "Añade al menos un filtro antes de ejecutar.",
        variant: "destructive",
      });
      return;
    }
    try {
      await exec.mutateAsync({ projectId, query: tree });
    } catch (err) {
      toast({
        title: "Falló la consulta",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  async function saveCurrent() {
    const trimmed = savedName.trim();
    if (!trimmed) {
      toast({ title: "Ponle un nombre a la consulta", variant: "destructive" });
      return;
    }
    try {
      const id = await save.mutateAsync({
        id: savedId ?? undefined,
        projectId,
        name: trimmed,
        definition: tree,
      });
      setSavedId(id);
      toast({ title: "Consulta guardada" });
    } catch (err) {
      toast({
        title: "No se pudo guardar",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function convertResultsToCode() {
    if (!exec.data || exec.data.quotationIds.length === 0) return;
    const name = window.prompt("Nombre del código nuevo", savedName || "Resultado de consulta");
    if (!name) return;
    try {
      const { codeId, count } = await applyAsCode.mutateAsync({
        projectId,
        codeName: name,
        quotationIds: exec.data.quotationIds,
      });
      toast({
        title: `Código creado`,
        description: `Aplicado a ${count} citas. ID ${codeId.slice(0, 8)}.`,
      });
    } catch (err) {
      toast({
        title: "No se pudo crear el código",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function makeSmartCode() {
    const name = window.prompt(
      "Nombre del smart code (su lista de citas se recalcula en vivo desde la consulta actual)",
      savedName || "Smart code"
    );
    if (!name) return;
    try {
      await smart.mutateAsync({ projectId, name, definition: tree });
      toast({
        title: "Smart code creado",
        description: "Aparece en el codebook; su membresía se recalcula ejecutando la consulta enlazada.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el smart code",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Constructor</h3>
            <Button size="sm" variant="ghost" onClick={() => { setTree(EMPTY_AND); setSavedId(null); setSavedName(""); }}>
              Reiniciar
            </Button>
          </div>
          <div className="mt-3">
            <NodeEditor
              node={tree}
              onChange={setTree}
              codeOptions={(codes ?? []).map((c) => ({ id: c.id, label: c.name }))}
              docOptions={(documents ?? []).map((d) => ({ id: d.id, label: d.title }))}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={runQuery} disabled={exec.isPending}>
              {exec.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Ejecutar consulta
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <Input
                placeholder="Nombre de la consulta"
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
                className="h-9 w-56"
              />
              <Button onClick={saveCurrent} variant="outline" size="sm" disabled={save.isPending}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {savedId ? "Guardar cambios" : "Guardar"}
              </Button>
            </div>
          </div>
        </div>

        {exec.data && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {exec.data.total} citas coinciden
                {exec.data.capped && (
                  <span className="ml-2 text-xs text-amber-600">
                    (mostrando los primeros {exec.data.quotationIds.length})
                  </span>
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={convertResultsToCode}
                disabled={exec.data.quotationIds.length === 0 || applyAsCode.isPending}
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                Convertir resultado en código
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={makeSmartCode}
                disabled={smart.isPending}
                title="Smart code: el código se enlaza a esta consulta y su lista de citas se recalcula automáticamente"
              >
                {smart.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Crear smart code
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">Consultas guardadas</h3>
          <ul className="mt-2 space-y-1">
            {(savedQueries ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">Aún no has guardado ninguna.</li>
            )}
            {(savedQueries ?? []).map((q) => (
              <li
                key={q.id}
                className={`group flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted/50 ${q.id === savedId ? "bg-primary/10" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => loadSaved(q)}
                  className="truncate text-left"
                >
                  {q.name}
                </button>
                <button
                  type="button"
                  onClick={() => del.mutate({ id: q.id, projectId })}
                  className="opacity-0 transition group-hover:opacity-100"
                  title="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Cómo funciona</p>
          <ul className="mt-1 space-y-1 list-disc pl-4">
            <li>AND = todas las condiciones (intersección de citas).</li>
            <li>OR = cualquiera (unión).</li>
            <li>NOT = excluye las citas que cumplen la condición.</li>
            <li>"Co-ocurre" = citas con AMBOS códigos a la vez.</li>
          </ul>
          <p className="mt-2">
            Tras ejecutar, puedes convertir el resultado en un código nuevo.
          </p>
        </div>
      </aside>

      {/* Helpful: render the resolved code/document names below the tree */}
      {exec.data && exec.data.quotationIds.length > 0 && (
        <ResultsList
          ids={exec.data.quotationIds}
          projectId={projectId}
          codeMap={codeMap}
          docMap={docMap}
        />
      )}
    </div>
  );
}

// =====================================================
// Recursive node editor
// =====================================================

interface NodeEditorProps {
  node: QueryNode;
  onChange: (n: QueryNode) => void;
  codeOptions: { id: string; label: string }[];
  docOptions: { id: string; label: string }[];
}

function NodeEditor({ node, onChange, codeOptions, docOptions }: NodeEditorProps) {
  if (node.op === "and" || node.op === "or") {
    return (
      <BoolBlock
        node={node}
        onChange={onChange}
        codeOptions={codeOptions}
        docOptions={docOptions}
      />
    );
  }
  if (node.op === "not") {
    return (
      <div className="rounded border border-dashed bg-red-500/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-red-700">NOT</span>
        </div>
        <NodeEditor node={node.child} onChange={(c) => onChange({ op: "not", child: c })} codeOptions={codeOptions} docOptions={docOptions} />
      </div>
    );
  }
  return (
    <LeafEditor
      node={node}
      onChange={onChange}
      codeOptions={codeOptions}
      docOptions={docOptions}
    />
  );
}

function BoolBlock({ node, onChange, codeOptions, docOptions }: NodeEditorProps & {
  node: { op: "and" | "or"; children: QueryNode[] };
}) {
  function update(idx: number, child: QueryNode) {
    const next = [...node.children];
    next[idx] = child;
    onChange({ op: node.op, children: next });
  }
  function remove(idx: number) {
    onChange({ op: node.op, children: node.children.filter((_, i) => i !== idx) });
  }
  function addChild(kind: QueryNode["op"]) {
    const fresh = freshNode(kind, codeOptions, docOptions);
    if (!fresh) return;
    onChange({ op: node.op, children: [...node.children, fresh] });
  }

  return (
    <div className={`rounded border ${node.op === "and" ? "border-blue-500/40 bg-blue-500/5" : "border-violet-500/40 bg-violet-500/5"} p-3`}>
      <div className="mb-2 flex items-center gap-2">
        <Select value={node.op} onValueChange={(v) => onChange({ op: v as "and" | "or", children: node.children })}>
          <SelectTrigger className="h-7 w-20 text-xs font-bold uppercase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">AND</SelectItem>
            <SelectItem value="or">OR</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => addChild("code")} title="Filtrar por código">
            <Tags className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addChild("document")} title="Filtrar por documento">
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addChild("sentiment")} title="Filtrar por sentimiento">
            <Smile className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addChild("cooccurs")} title="Co-ocurrencia">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addChild(node.op === "and" ? "or" : "and")} title="Subgrupo">
            ( )
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addChild("not")} title="Negación">
            ¬
          </Button>
        </div>
      </div>
      <div className="space-y-2 pl-2">
        {node.children.map((child, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <NodeEditor node={child} onChange={(c) => update(i, c)} codeOptions={codeOptions} docOptions={docOptions} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => remove(i)} className="mt-1">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        ))}
        {node.children.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            Vacío — usa los botones de arriba para añadir condiciones.
          </p>
        )}
      </div>
    </div>
  );
}

function LeafEditor({ node, onChange, codeOptions, docOptions }: NodeEditorProps) {
  if (node.op === "code") {
    return (
      <div className="flex items-center gap-2 rounded border bg-card px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">Código</span>
        <Select value={node.codeId} onValueChange={(v) => onChange({ op: "code", codeId: v })}>
          <SelectTrigger className="h-8 flex-1 text-sm">
            <SelectValue placeholder="Selecciona un código…" />
          </SelectTrigger>
          <SelectContent>
            {codeOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (node.op === "document") {
    return (
      <div className="flex items-center gap-2 rounded border bg-card px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">En documento</span>
        <Select value={node.documentId} onValueChange={(v) => onChange({ op: "document", documentId: v })}>
          <SelectTrigger className="h-8 flex-1 text-sm">
            <SelectValue placeholder="Selecciona un documento…" />
          </SelectTrigger>
          <SelectContent>
            {docOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (node.op === "sentiment") {
    return (
      <div className="flex items-center gap-2 rounded border bg-card px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">Sentimiento</span>
        <Select
          value={node.label}
          onValueChange={(v) => onChange({ op: "sentiment", label: v as "positive" | "negative" | "neutral" | "mixed" })}
        >
          <SelectTrigger className="h-8 flex-1 text-sm">
            <SelectValue placeholder="…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="positive">positivo</SelectItem>
            <SelectItem value="neutral">neutro</SelectItem>
            <SelectItem value="mixed">mixto</SelectItem>
            <SelectItem value="negative">negativo</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (node.op === "cooccurs") {
    return (
      <div className="space-y-2 rounded border bg-card px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">Co-ocurrencia (ambos códigos)</span>
        <div className="flex gap-2">
          <Select value={node.a} onValueChange={(v) => onChange({ op: "cooccurs", a: v, b: node.b })}>
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue placeholder="Código A…" />
            </SelectTrigger>
            <SelectContent>
              {codeOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={node.b} onValueChange={(v) => onChange({ op: "cooccurs", a: node.a, b: v })}>
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue placeholder="Código B…" />
            </SelectTrigger>
            <SelectContent>
              {codeOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  return null;
}

// =====================================================
// Helpers
// =====================================================

function freshNode(
  op: QueryNode["op"],
  codeOptions: { id: string }[],
  docOptions: { id: string }[]
): QueryNode | null {
  switch (op) {
    case "and":
    case "or":
      return { op, children: [] };
    case "not":
      return { op: "not", child: { op: "code", codeId: codeOptions[0]?.id ?? "" } };
    case "code":
      return { op: "code", codeId: codeOptions[0]?.id ?? "" };
    case "document":
      return { op: "document", documentId: docOptions[0]?.id ?? "" };
    case "sentiment":
      return { op: "sentiment", label: "positive" };
    case "cooccurs":
      return { op: "cooccurs", a: codeOptions[0]?.id ?? "", b: codeOptions[1]?.id ?? "" };
    default:
      return null;
  }
}

function isExecutable(node: QueryNode): boolean {
  switch (node.op) {
    case "and":
    case "or":
      return node.children.length > 0 && node.children.every(isExecutable);
    case "not":
      return isExecutable(node.child);
    case "code":
      return !!node.codeId;
    case "document":
      return !!node.documentId;
    case "sentiment":
      return !!node.label;
    case "cooccurs":
      return !!node.a && !!node.b && node.a !== node.b;
    default:
      return false;
  }
}

function ResultsList({
  ids,
  codeMap,
  docMap,
}: {
  ids: string[];
  projectId: string;
  codeMap: Map<string, { id: string; name: string }>;
  docMap: Map<string, { id: string; title: string }>;
}) {
  // We don't refetch quotation rows here — a focused hook would add
  // significant complexity for the scope of this panel. Showing the
  // ID + count is enough; users navigate to quotations panel for detail.
  // (Future improvement: link each id to /app/p/:projectId/d/...?quote=id)
  return (
    <div className="lg:col-span-2 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">IDs de citas que coinciden:</p>
      <p className="mt-1 break-all font-mono">
        {ids.slice(0, 30).map((id) => id.slice(0, 8)).join("  ")}
        {ids.length > 30 && ` … +${ids.length - 30} más`}
      </p>
      <p className="mt-2">
        {codeMap.size} códigos y {docMap.size} documentos disponibles para construir consultas.
      </p>
    </div>
  );
}
