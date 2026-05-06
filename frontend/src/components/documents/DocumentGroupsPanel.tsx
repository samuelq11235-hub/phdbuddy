import { useState } from "react";
import { Folders, Plus, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  useDocumentGroups,
  useCreateDocumentGroup,
  useDeleteDocumentGroup,
  useDocumentGroupMembers,
  useAddDocumentsToGroup,
  useRemoveDocumentFromGroup,
  useDocumentAttributeSchema,
  useCreateAttribute,
  useDeleteAttribute,
} from "@/hooks/useDocumentGroups";
import { useDocuments } from "@/hooks/useDocuments";
import { canWrite, useMyRole } from "@/hooks/useMembers";
import { useToast } from "@/hooks/use-toast";
import type { AttributeDataType } from "@/types/database";

interface Props { projectId: string; }

export function DocumentGroupsPanel({ projectId }: Props) {
  const { data: myRole } = useMyRole(projectId);
  const writable = canWrite(myRole);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Grupos y atributos</h2>
        <p className="text-sm text-muted-foreground">
          Organiza documentos en grupos (cohorte 2024, piloto, etc.) y define atributos personalizados (idioma, género, año…).
        </p>
      </header>
      <GroupsSection projectId={projectId} writable={writable} />
      <AttributesSection projectId={projectId} writable={writable} />
    </div>
  );
}

// =====================================================
// Groups
// =====================================================

function GroupsSection({ projectId, writable }: { projectId: string; writable: boolean }) {
  const { data: groups, isLoading } = useDocumentGroups(projectId);
  const create = useCreateDocumentGroup();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ projectId, name: name.trim() });
      setName("");
      setCreating(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el grupo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Folders className="mr-1.5 inline h-4 w-4" />
          Grupos de documentos
        </h3>
        {writable && (
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nuevo grupo
          </Button>
        )}
      </div>

      {creating && (
        <form onSubmit={submit} className="mb-3 flex items-end gap-2">
          <div className="flex-1">
            <Input
              autoFocus
              placeholder="Nombre del grupo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear
          </Button>
        </form>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {(groups ?? []).length === 0 && !isLoading && (
        <p className="text-sm italic text-muted-foreground">Aún no hay grupos. Empieza por crear uno.</p>
      )}

      <ul className="space-y-2">
        {(groups ?? []).map((g) => (
          <li key={g.id}>
            <GroupRow
              projectId={projectId}
              group={g}
              writable={writable}
              expanded={activeGroupId === g.id}
              onToggle={() => setActiveGroupId(activeGroupId === g.id ? null : g.id)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupRow({
  projectId,
  group,
  writable,
  expanded,
  onToggle,
}: {
  projectId: string;
  group: { id: string; name: string; color: string; description: string | null };
  writable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data: members } = useDocumentGroupMembers(expanded ? group.id : undefined);
  const { data: docs } = useDocuments(projectId);
  const add = useAddDocumentsToGroup();
  const remove = useRemoveDocumentFromGroup();
  const del = useDeleteDocumentGroup();
  const memberIds = new Set((members ?? []).map((m) => m.document_id));
  const memberDocs = (docs ?? []).filter((d) => memberIds.has(d.id));
  const nonMemberDocs = (docs ?? []).filter((d) => !memberIds.has(d.id));
  const [adding, setAdding] = useState<string>("");

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: group.color }} />
          <span className="font-medium">{group.name}</span>
          {expanded ? (
            <span className="text-xs text-muted-foreground">— ocultar</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              ({memberIds.size > 0 ? `${memberIds.size} docs` : "ver"})
            </span>
          )}
        </button>
        {writable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`¿Eliminar grupo "${group.name}"? Los documentos no se borran.`)) {
                del.mutate({ id: group.id, projectId });
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="border-t bg-muted/20 px-3 py-2">
          {memberDocs.length === 0 && (
            <p className="text-sm italic text-muted-foreground">
              Sin documentos en este grupo todavía.
            </p>
          )}
          <ul className="space-y-1">
            {memberDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>{d.title}</span>
                {writable && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      remove.mutate({ groupId: group.id, documentId: d.id })
                    }
                  >
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {writable && nonMemberDocs.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <select
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="">— añadir documento —</option>
                {nonMemberDocs.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!adding}
                onClick={async () => {
                  await add.mutateAsync({ groupId: group.id, documentIds: [adding] });
                  setAdding("");
                }}
              >
                Añadir
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Attributes
// =====================================================

function AttributesSection({ projectId, writable }: { projectId: string; writable: boolean }) {
  const { data: schema } = useDocumentAttributeSchema(projectId);
  const create = useCreateAttribute();
  const del = useDeleteAttribute();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AttributeDataType>("text");
  const [optionsText, setOptionsText] = useState("");
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const opts =
      type === "choice"
        ? optionsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        data_type: type,
        options: opts,
      });
      setOpen(false);
      setName("");
      setOptionsText("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el atributo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Atributos personalizados
        </h3>
        {writable && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nuevo atributo
          </Button>
        )}
      </div>
      {(schema ?? []).length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Aún no hay atributos. Defínelos para clasificar tus documentos (idioma, año, cohorte…).
        </p>
      ) : (
        <ul className="space-y-1">
          {(schema ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-1.5 text-sm"
            >
              <div>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{s.data_type}</span>
                {s.options && Array.isArray(s.options) && s.options.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    [{s.options.join(", ")}]
                  </span>
                )}
              </div>
              {writable && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del.mutate({ id: s.id, projectId })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo atributo</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nombre</label>
              <Input
                placeholder="ej. idioma, año, género"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tipo</label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as AttributeDataType)}
              >
                <option value="text">Texto libre</option>
                <option value="number">Número</option>
                <option value="date">Fecha</option>
                <option value="choice">Elección (lista)</option>
              </select>
            </div>
            {type === "choice" && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Opciones (separadas por coma)
                </label>
                <Input
                  placeholder="hombre, mujer, otro"
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                Crear
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
