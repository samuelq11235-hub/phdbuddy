import { useMemo, useState } from "react";
import {
  Plus,
  Tags,
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Pencil,
  Layers,
  X,
  CheckSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCodeTree,
  useDeleteCode,
  useUpdateCode,
  type CodeNode,
} from "@/hooks/useCodes";
import {
  useCodeGroups,
  useCodeGroupMembers,
  useDeleteCodeGroup,
  useRemoveCodeFromGroup,
} from "@/hooks/useCodeGroups";
import { canWrite, useMyRole } from "@/hooks/useMembers";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Code, CodeGroup } from "@/types/database";
import { NewCodeDialog } from "./NewCodeDialog";
import { NewCodeGroupDialog } from "./NewCodeGroupDialog";
import { AssignToGroupDialog } from "./AssignToGroupDialog";

type ViewMode = "tree" | "groups";

export function CodebookPanel({ projectId }: { projectId: string }) {
  const { tree, isLoading, data: codes } = useCodeTree(projectId);
  const { data: groups, isLoading: groupsLoading } = useCodeGroups(projectId);
  const { data: members } = useCodeGroupMembers(projectId);
  const { data: myRole } = useMyRole(projectId);
  const writable = canWrite(myRole);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("tree");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filteredTree = filterTree(tree, search);
  const totalCodes = codes?.length ?? 0;
  const totalGroups = groups?.length ?? 0;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const visibleCodes = useMemo(
    () => filterCodes(codes ?? [], search),
    [codes, search]
  );

  function selectAllVisible() {
    setSelected(new Set(visibleCodes.map((c) => c.id)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Codebook</h2>
          <p className="text-sm text-muted-foreground">
            {totalCodes} {totalCodes === 1 ? "código" : "códigos"}
            {totalGroups > 0 && (
              <>
                {" · "}
                {totalGroups} {totalGroups === 1 ? "grupo" : "grupos"}
              </>
            )}
            . Construye el vocabulario conceptual de tu estudio.
          </p>
        </div>
        {writable && (
          <div className="flex flex-wrap items-center gap-2">
            <NewCodeGroupDialog
              projectId={projectId}
              trigger={
                <Button variant="outline">
                  <Layers className="mr-2 h-4 w-4" />
                  Nuevo grupo
                </Button>
              }
            />
            <NewCodeDialog
              projectId={projectId}
              trigger={
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo código
                </Button>
              }
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
          <ViewToggle
            label="Jerarquía"
            active={view === "tree"}
            onClick={() => setView("tree")}
          />
          <ViewToggle
            label="Por grupo"
            active={view === "groups"}
            onClick={() => setView("groups")}
          />
        </div>

        <Input
          type="search"
          placeholder="Buscar códigos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm flex-1"
        />

        {visibleCodes.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={selectAllVisible}
            type="button"
          >
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
            Seleccionar visibles
          </Button>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
          <p className="text-sm font-medium text-primary">
            {selectedIds.length} {selectedIds.length === 1 ? "código seleccionado" : "códigos seleccionados"}
          </p>
          <div className="flex items-center gap-2">
            <AssignToGroupDialog
              projectId={projectId}
              codeIds={selectedIds}
              onAssigned={clearSelection}
            />
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpiar
            </Button>
          </div>
        </div>
      )}

      {isLoading || groupsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : view === "tree" ? (
        filteredTree.length === 0 ? (
          <EmptyState search={search} projectId={projectId} />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <CodeTree
              projectId={projectId}
              nodes={filteredTree}
              selected={selected}
              onToggle={toggleSelected}
            />
          </div>
        )
      ) : (
        <GroupedView
          projectId={projectId}
          codes={visibleCodes}
          allCodes={codes ?? []}
          groups={groups ?? []}
          members={members ?? []}
          selected={selected}
          onToggle={toggleSelected}
          search={search}
        />
      )}
    </div>
  );
}

function ViewToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({
  search,
  projectId,
}: {
  search: string;
  projectId: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Tags className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">
        {search ? "No hay códigos que coincidan" : "Tu codebook está vacío"}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {search
          ? "Prueba con otro término de búsqueda o limpia el filtro."
          : "Añade códigos manualmente o ejecuta auto-codificación con IA sobre un documento para generar un codebook inicial."}
      </p>
      {!search && (
        <NewCodeDialog
          projectId={projectId}
          trigger={
            <Button className="mt-6">
              <Plus className="mr-2 h-4 w-4" />
              Crear el primer código
            </Button>
          }
        />
      )}
    </div>
  );
}

// =============================================================
// Tree view
// =============================================================

function CodeTree({
  projectId,
  nodes,
  selected,
  onToggle,
}: {
  projectId: string;
  nodes: CodeNode[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="divide-y">
      {nodes.map((node) => (
        <CodeRow
          key={node.id}
          node={node}
          projectId={projectId}
          depth={0}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function CodeRow({
  node,
  projectId,
  depth,
  selected,
  onToggle,
}: {
  node: CodeNode;
  projectId: string;
  depth: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const [draftDesc, setDraftDesc] = useState(node.description ?? "");

  const updateCode = useUpdateCode();
  const deleteCode = useDeleteCode();
  const { toast } = useToast();

  const isSelected = selected.has(node.id);

  async function handleSave() {
    if (!draftName.trim()) return;
    try {
      await updateCode.mutateAsync({
        id: node.id,
        name: draftName.trim(),
        description: draftDesc.trim() || null,
      });
      setEditing(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la actualización",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `¿Eliminar el código "${node.name}"? Las citas codificadas perderán este código.`
      )
    )
      return;
    try {
      await deleteCode.mutateAsync(node);
      toast({ title: "Código eliminado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la eliminación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          "flex items-start gap-2 px-3 py-2.5 hover:bg-muted/30",
          editing && "bg-muted/30",
          isSelected && "bg-primary/5"
        )}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <input
          type="checkbox"
          aria-label={`Seleccionar ${node.name}`}
          checked={isSelected}
          onChange={() => onToggle(node.id)}
          className="mt-1.5 h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-muted-foreground/40 text-primary focus:ring-primary"
        />

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted",
            !hasChildren && "invisible"
          )}
          aria-label={open ? "Contraer" : "Expandir"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <span
          className="mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: node.color }}
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="h-8"
              />
              <Input
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder="Descripción (opcional)"
                className="h-8 text-xs"
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{node.name}</span>
                {node.created_by_ai && (
                  <Sparkles className="h-3 w-3 text-primary" aria-label="Generado por IA" />
                )}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {node.usage_count} {node.usage_count === 1 ? "uso" : "usos"}
                </span>
              </div>
              {node.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {node.description}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave} disabled={updateCode.isPending}>
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <NewCodeDialog
                projectId={projectId}
                parentId={node.id}
                trigger={
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Añadir subcódigo">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Editar"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Eliminar"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {hasChildren && open && (
        <ul className="bg-muted/10">
          {node.children.map((child) => (
            <CodeRow
              key={child.id}
              node={child}
              projectId={projectId}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// =============================================================
// Grouped view
// =============================================================

function GroupedView({
  projectId,
  codes,
  allCodes,
  groups,
  members,
  selected,
  onToggle,
  search,
}: {
  projectId: string;
  codes: Code[];
  allCodes: Code[];
  groups: CodeGroup[];
  members: { code_id: string; code_group_id: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  search: string;
}) {
  const codeById = useMemo(() => {
    const m = new Map<string, Code>();
    for (const c of allCodes) m.set(c.id, c);
    return m;
  }, [allCodes]);

  const visibleIds = useMemo(() => new Set(codes.map((c) => c.id)), [codes]);

  // Build per-group code lists, only including codes that are visible
  // under the current search filter.
  const codesByGroup = useMemo(() => {
    const map = new Map<string, Code[]>();
    for (const m of members) {
      if (!visibleIds.has(m.code_id)) continue;
      const code = codeById.get(m.code_id);
      if (!code) continue;
      const list = map.get(m.code_group_id) ?? [];
      list.push(code);
      map.set(m.code_group_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [members, codeById, visibleIds]);

  const groupedCodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) set.add(m.code_id);
    return set;
  }, [members]);

  const ungrouped = useMemo(
    () => codes.filter((c) => !groupedCodeIds.has(c.id)),
    [codes, groupedCodeIds]
  );

  if (groups.length === 0 && ungrouped.length === 0) {
    return <EmptyState search={search} projectId={projectId} />;
  }

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Aún no hay grupos. Crea uno con "Nuevo grupo" para organizar tus códigos
          de forma transversal a la jerarquía.
        </div>
      )}

      {groups.map((group) => (
        <GroupAccordion
          key={group.id}
          projectId={projectId}
          group={group}
          codes={codesByGroup.get(group.id) ?? []}
          selected={selected}
          onToggle={onToggle}
        />
      ))}

      <UngroupedAccordion
        projectId={projectId}
        codes={ungrouped}
        selected={selected}
        onToggle={onToggle}
      />
    </div>
  );
}

function GroupAccordion({
  projectId,
  group,
  codes,
  selected,
  onToggle,
}: {
  projectId: string;
  group: CodeGroup;
  codes: Code[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const deleteGroup = useDeleteCodeGroup();
  const removeMember = useRemoveCodeFromGroup();
  const { toast } = useToast();

  async function handleDeleteGroup() {
    if (
      !confirm(
        `¿Eliminar el grupo "${group.name}"? Los códigos no se borran, solo dejan de estar agrupados.`
      )
    )
      return;
    try {
      await deleteGroup.mutateAsync({ id: group.id, project_id: group.project_id });
      toast({ title: "Grupo eliminado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar el grupo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleRemoveMember(codeId: string, codeName: string) {
    try {
      await removeMember.mutateAsync({
        projectId,
        groupId: group.id,
        codeId,
      });
      toast({
        title: "Código quitado del grupo",
        description: `"${codeName}" ya no pertenece a "${group.name}".`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo quitar del grupo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderLeft: `3px solid ${group.color}` }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <span
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: group.color }}
          />
          <span className="truncate font-semibold">{group.name}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {codes.length} {codes.length === 1 ? "código" : "códigos"}
          </span>
          {group.description && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              · {group.description}
            </span>
          )}
        </button>

        <div className="flex flex-shrink-0 items-center gap-1">
          <NewCodeGroupDialog
            projectId={projectId}
            group={group}
            trigger={
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar grupo">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Eliminar grupo"
            onClick={handleDeleteGroup}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {open && (
        <ul className="divide-y border-t bg-muted/10">
          {codes.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              Sin códigos. Asigna códigos a este grupo desde la barra de selección
              o desde el diálogo de nuevo código.
            </li>
          ) : (
            codes.map((code) => (
              <GroupCodeRow
                key={code.id}
                code={code}
                selected={selected.has(code.id)}
                onToggle={() => onToggle(code.id)}
                onRemove={() => handleRemoveMember(code.id, code.name)}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function UngroupedAccordion({
  projectId: _projectId,
  codes,
  selected,
  onToggle,
}: {
  projectId: string;
  codes: Code[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(codes.length > 0);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        <Tags className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="font-semibold">Sin agrupar</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {codes.length} {codes.length === 1 ? "código" : "códigos"}
        </span>
      </button>

      {open && (
        <ul className="divide-y border-t bg-muted/10">
          {codes.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              Todos los códigos pertenecen a algún grupo.
            </li>
          ) : (
            codes.map((code) => (
              <GroupCodeRow
                key={code.id}
                code={code}
                selected={selected.has(code.id)}
                onToggle={() => onToggle(code.id)}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function GroupCodeRow({
  code,
  selected,
  onToggle,
  onRemove,
}: {
  code: Code;
  selected: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 px-3 py-2 hover:bg-muted/30",
        selected && "bg-primary/5"
      )}
    >
      <input
        type="checkbox"
        aria-label={`Seleccionar ${code.name}`}
        checked={selected}
        onChange={onToggle}
        className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-muted-foreground/40 text-primary focus:ring-primary"
      />
      <span
        className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: code.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{code.name}</span>
          {code.created_by_ai && (
            <Sparkles className="h-3 w-3 text-primary" aria-label="Generado por IA" />
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {code.usage_count} {code.usage_count === 1 ? "uso" : "usos"}
          </span>
        </div>
        {code.description && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {code.description}
          </p>
        )}
      </div>
      {onRemove && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label="Quitar del grupo"
          onClick={onRemove}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

// =============================================================
// Filter helpers
// =============================================================

function filterTree(tree: CodeNode[], search: string): CodeNode[] {
  if (!search.trim()) return tree;
  const q = search.toLowerCase();
  return tree
    .map((node) => filterNode(node, q))
    .filter((n): n is CodeNode => !!n);
}

function filterNode(node: CodeNode, q: string): CodeNode | null {
  const selfMatches =
    node.name.toLowerCase().includes(q) ||
    (node.description ?? "").toLowerCase().includes(q);
  const filteredChildren = node.children
    .map((c) => filterNode(c, q))
    .filter((c): c is CodeNode => !!c);
  if (selfMatches || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }
  return null;
}

function filterCodes(codes: Code[], search: string): Code[] {
  if (!search.trim()) return codes;
  const q = search.toLowerCase();
  return codes.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q)
  );
}
