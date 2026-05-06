import { useState } from "react";
import { Plus, NotebookPen, Trash2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemos, useCreateMemo, useDeleteMemo, useUpdateMemo } from "@/hooks/useMemos";
import { canWrite, useMyRole } from "@/hooks/useMembers";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Memo, MemoType } from "@/types/database";

const KIND_LABEL: Record<MemoType, string> = {
  analytic: "Analítico",
  methodological: "Metodológico",
  theoretical: "Teórico",
  reflective: "Reflexivo",
};

const KIND_COLOR: Record<MemoType, string> = {
  analytic: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  methodological: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  theoretical: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  reflective: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function MemosPanel({ projectId }: { projectId: string }) {
  const { data: memos, isLoading } = useMemos(projectId);
  const { data: myRole } = useMyRole(projectId);
  const writable = canWrite(myRole);
  const [activeMemoId, setActiveMemoId] = useState<string | null>(null);
  const activeMemo = memos?.find((m) => m.id === activeMemoId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Memos</h2>
          {writable && (
            <NewMemoDialog projectId={projectId} onCreated={(m) => setActiveMemoId(m.id)} />
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : !memos || memos.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-muted/20 px-4 py-10 text-center">
            <NotebookPen className="mx-auto h-8 w-8 text-primary opacity-70" />
            <p className="mt-3 text-sm font-medium">Aún no hay memos</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Captura tu pensamiento mientras analizas.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {memos.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setActiveMemoId(m.id)}
                  className={cn(
                    "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50",
                    activeMemoId === m.id && "border-primary bg-primary/5"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="line-clamp-1 font-medium">{m.title}</h3>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", KIND_COLOR[m.kind])}>
                      {KIND_LABEL[m.kind]}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {m.content || <em>Sin contenido</em>}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border bg-card p-5">
        {activeMemo ? (
          <MemoEditor memo={activeMemo} key={activeMemo.id} onDelete={() => setActiveMemoId(null)} />
        ) : (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
            <NotebookPen className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Selecciona un memo a la izquierda o crea uno nuevo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoEditor({ memo, onDelete }: { memo: Memo; onDelete: () => void }) {
  const [title, setTitle] = useState(memo.title);
  const [content, setContent] = useState(memo.content);
  const [kind, setKind] = useState<MemoType>(memo.kind);
  const update = useUpdateMemo();
  const del = useDeleteMemo();
  const { toast } = useToast();

  const dirty =
    title.trim() !== memo.title || content !== memo.content || kind !== memo.kind;

  async function handleSave() {
    if (!title.trim()) return;
    try {
      await update.mutateAsync({ id: memo.id, title: title.trim(), content, kind });
      toast({ title: "Memo guardado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el guardado",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este memo?")) return;
    try {
      await del.mutateAsync(memo);
      onDelete();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló la eliminación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border-none bg-transparent p-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Eliminar
        </Button>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as MemoType)}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as MemoType[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={18}
        placeholder="Escribe aquí tu memo. Se admite Markdown."
        className="flex-1 resize-none font-mono text-sm leading-relaxed"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" disabled={!dirty} onClick={() => {
          setTitle(memo.title);
          setContent(memo.content);
          setKind(memo.kind);
        }}>
          Restablecer
        </Button>
        <Button onClick={handleSave} disabled={!dirty || update.isPending}>
          {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Guardar memo
        </Button>
      </div>
    </div>
  );
}

function NewMemoDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated?: (memo: Memo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MemoType>("analytic");
  const create = useCreateMemo();
  const { toast } = useToast();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const memo = await create.mutateAsync({ projectId, title: title.trim(), kind });
      onCreated?.(memo);
      setTitle("");
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el memo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nuevo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleCreate} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo memo</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="memo-title">Título</Label>
            <Input
              id="memo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="p. ej., Reflexiones iniciales sobre la dimensión de burnout"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MemoType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as MemoType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear memo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
