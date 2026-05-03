import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

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
import type { Code } from "@/types/database";

export function AddCodesDialog({
  codes,
  alreadyAdded,
  trigger,
  onConfirm,
}: {
  codes: Code[];
  alreadyAdded: Set<string>;
  trigger?: ReactNode;
  onConfirm: (codeIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return codes
      .filter((c) => !alreadyAdded.has(c.id))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name));
  }, [codes, alreadyAdded, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setSearch("");
    setSelected(new Set());
  }

  function handleConfirm() {
    if (selected.size === 0) return;
    onConfirm([...selected]);
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Añadir códigos
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Añadir códigos a la red</DialogTitle>
          <DialogDescription>
            Selecciona uno o varios códigos del codebook para colocarlos en el lienzo.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Buscar código…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="max-h-[320px] overflow-y-auto rounded-lg border">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {alreadyAdded.size === codes.length
                ? "Ya has añadido todos los códigos del proyecto."
                : "Sin coincidencias."}
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const checked = selected.has(c.id);
                return (
                  <li key={c.id}>
                    <label
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="flex-1 truncate text-sm">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.usage_count} {c.usage_count === 1 ? "uso" : "usos"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            Añadir {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
