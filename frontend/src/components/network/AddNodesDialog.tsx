import { useMemo, useState, type ReactNode } from "react";
import { Plus, Quote, NotebookPen, FileText, Tags } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Code, Document, Memo, LinkEntityType } from "@/types/database";
import type { QuotationWithCodes } from "@/hooks/useQuotations";

interface AddSelection {
  type: LinkEntityType;
  id: string;
}

/**
 * Universal node picker for the network canvas. Lets the user add any
 * mix of codes, quotations, memos and documents into the same network
 * — exactly like Atlas.ti's "Open Network" / "Import Neighbors" flow.
 */
export function AddNodesDialog({
  codes,
  quotations,
  memos,
  documents,
  alreadyAdded,
  trigger,
  onConfirm,
}: {
  codes: Code[];
  quotations: QuotationWithCodes[];
  memos: Memo[];
  documents: Document[];
  // Set of "<type>:<id>" keys already on the canvas — these are hidden.
  alreadyAdded: Set<string>;
  trigger?: ReactNode;
  onConfirm: (selection: AddSelection[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LinkEntityType>("code");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, AddSelection>>(new Map());

  const q = search.trim().toLowerCase();

  const filteredCodes = useMemo(
    () =>
      codes
        .filter((c) => !alreadyAdded.has(`code:${c.id}`))
        .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
        .sort((a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name)),
    [codes, alreadyAdded, q]
  );

  const filteredQuotations = useMemo(
    () =>
      quotations
        .filter((quote) => !alreadyAdded.has(`quotation:${quote.id}`))
        .filter((quote) => (q ? quote.content.toLowerCase().includes(q) : true))
        .slice(0, 200),
    [quotations, alreadyAdded, q]
  );

  const filteredMemos = useMemo(
    () =>
      memos
        .filter((m) => !alreadyAdded.has(`memo:${m.id}`))
        .filter((m) =>
          q
            ? m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)
            : true
        ),
    [memos, alreadyAdded, q]
  );

  const filteredDocuments = useMemo(
    () =>
      documents
        .filter((d) => !alreadyAdded.has(`document:${d.id}`))
        .filter((d) => (q ? d.title.toLowerCase().includes(q) : true)),
    [documents, alreadyAdded, q]
  );

  function toggle(type: LinkEntityType, id: string) {
    const key = `${type}:${id}`;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { type, id });
      return next;
    });
  }

  function isSelected(type: LinkEntityType, id: string) {
    return selected.has(`${type}:${id}`);
  }

  function reset() {
    setSearch("");
    setSelected(new Map());
    setTab("code");
  }

  function handleConfirm() {
    if (selected.size === 0) return;
    onConfirm([...selected.values()]);
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
            Añadir nodos
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Añadir nodos al lienzo</DialogTitle>
          <DialogDescription>
            Combina códigos, citas, memos y documentos en una misma red para construir
            tu mapa conceptual o esquema de evidencia.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as LinkEntityType)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="code" className="gap-1.5">
              <Tags className="h-3.5 w-3.5" />
              Códigos
            </TabsTrigger>
            <TabsTrigger value="quotation" className="gap-1.5">
              <Quote className="h-3.5 w-3.5" />
              Citas
            </TabsTrigger>
            <TabsTrigger value="memo" className="gap-1.5">
              <NotebookPen className="h-3.5 w-3.5" />
              Memos
            </TabsTrigger>
            <TabsTrigger value="document" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Documentos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="mt-3">
            <ListBox empty={filteredCodes.length === 0}>
              {filteredCodes.map((c) => (
                <Row
                  key={c.id}
                  checked={isSelected("code", c.id)}
                  onToggle={() => toggle("code", c.id)}
                  swatch={c.color}
                  primary={c.name}
                  meta={`${c.usage_count} ${c.usage_count === 1 ? "uso" : "usos"}`}
                />
              ))}
            </ListBox>
          </TabsContent>

          <TabsContent value="quotation" className="mt-3">
            <ListBox empty={filteredQuotations.length === 0}>
              {filteredQuotations.map((quote) => (
                <Row
                  key={quote.id}
                  checked={isSelected("quotation", quote.id)}
                  onToggle={() => toggle("quotation", quote.id)}
                  swatch="#f59e0b"
                  primary={quote.content.slice(0, 140)}
                  meta={quote.document_title ?? ""}
                  italic
                />
              ))}
            </ListBox>
          </TabsContent>

          <TabsContent value="memo" className="mt-3">
            <ListBox empty={filteredMemos.length === 0}>
              {filteredMemos.map((m) => (
                <Row
                  key={m.id}
                  checked={isSelected("memo", m.id)}
                  onToggle={() => toggle("memo", m.id)}
                  swatch="#8b5cf6"
                  primary={m.title}
                  meta={m.kind}
                />
              ))}
            </ListBox>
          </TabsContent>

          <TabsContent value="document" className="mt-3">
            <ListBox empty={filteredDocuments.length === 0}>
              {filteredDocuments.map((d) => (
                <Row
                  key={d.id}
                  checked={isSelected("document", d.id)}
                  onToggle={() => toggle("document", d.id)}
                  swatch="#0ea5e9"
                  primary={d.title}
                  meta={`${d.kind} · ${d.quotation_count} citas`}
                />
              ))}
            </ListBox>
          </TabsContent>
        </Tabs>

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

function ListBox({ empty, children }: { empty: boolean; children: ReactNode }) {
  return (
    <div className="max-h-[320px] overflow-y-auto rounded-lg border">
      {empty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sin coincidencias.
        </p>
      ) : (
        <ul className="divide-y">{children}</ul>
      )}
    </div>
  );
}

function Row({
  checked,
  onToggle,
  swatch,
  primary,
  meta,
  italic,
}: {
  checked: boolean;
  onToggle: () => void;
  swatch: string;
  primary: string;
  meta?: string;
  italic?: boolean;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 accent-primary"
        />
        <span
          className="h-3 w-3 flex-shrink-0 rounded-full"
          style={{ backgroundColor: swatch }}
        />
        <span className={`flex-1 truncate text-sm ${italic ? "italic" : ""}`}>
          {primary}
        </span>
        {meta ? (
          <span className="ml-2 truncate text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </label>
    </li>
  );
}
