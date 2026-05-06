import { useState } from "react";
import { Link as LinkIcon, Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react";
import {
  useQuotationLinks,
  useCreateQuotationLink,
  useDeleteQuotationLink,
} from "@/hooks/useHyperlinks";
import { useRelationTypes } from "@/hooks/useNetworks";
import { useDocumentQuotations } from "@/hooks/useQuotations";
import { useDocuments } from "@/hooks/useDocuments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Props {
  projectId: string;
  quotationId: string;
  canWrite: boolean;
}

// Hyperlinks live on a foldable subsection of each QuotationCard. We
// avoid rendering them by default to keep the list dense — the
// subsection only opens when the user clicks the badge or asks to add
// a new link.
export function QuotationLinks({ projectId, quotationId, canWrite }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data: links } = useQuotationLinks(quotationId);
  const remove = useDeleteQuotationLink();
  const { toast } = useToast();
  const count = links?.length ?? 0;

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <LinkIcon className="h-3 w-3" />
        Vínculos · {count}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 text-xs">
          {(links ?? []).length === 0 && (
            <p className="italic text-muted-foreground">Sin vínculos todavía.</p>
          )}
          {(links ?? []).map((l) => {
            const outgoing = l.from_quotation_id === quotationId;
            return (
              <div
                key={l.id}
                className="flex items-start gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
              >
                <div className="flex flex-shrink-0 items-center gap-1 text-muted-foreground">
                  {outgoing ? <ArrowRight className="h-3 w-3" /> : <ArrowLeft className="h-3 w-3" />}
                  <span
                    className="rounded px-1 text-[10px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: l.relation_type_color
                        ? `${l.relation_type_color}33`
                        : undefined,
                      color: l.relation_type_color ?? undefined,
                    }}
                  >
                    {l.relation_type_name ?? "(sin tipo)"}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2">"{l.to_content}"</div>
                  <div className="text-[10px] text-muted-foreground">
                    en {l.to_document_title}
                  </div>
                  {l.comment && <div className="mt-0.5 italic">{l.comment}</div>}
                </div>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(l)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Eliminar vínculo"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
              className="h-7 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              Vincular a otra cita…
            </Button>
          )}
        </div>
      )}

      {creating && (
        <CreateLinkDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={projectId}
          fromQuotationId={quotationId}
          onCreated={() => {
            toast({ title: "Vínculo creado" });
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function CreateLinkDialog({
  open,
  onOpenChange,
  projectId,
  fromQuotationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  fromQuotationId: string;
  onCreated: () => void;
}) {
  const { data: docs } = useDocuments(projectId);
  const [docId, setDocId] = useState<string>("");
  const { data: docQuotas } = useDocumentQuotations(docId || undefined);
  const { data: relations } = useRelationTypes(projectId);
  const create = useCreateQuotationLink();
  const { toast } = useToast();

  const [toQ, setToQ] = useState("");
  const [relId, setRelId] = useState("");
  const [comment, setComment] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toQ) return;
    try {
      await create.mutateAsync({
        projectId,
        fromQuotationId,
        toQuotationId: toQ,
        relationTypeId: relId || null,
        comment: comment || null,
      });
      onCreated();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el vínculo",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo vínculo entre citas</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Documento de la cita destino</label>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                setToQ("");
              }}
            >
              <option value="">— elige documento —</option>
              {(docs ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Cita destino</label>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={toQ}
              onChange={(e) => setToQ(e.target.value)}
              disabled={!docId}
            >
              <option value="">— elige cita —</option>
              {(docQuotas ?? [])
                .filter((q) => q.id !== fromQuotationId)
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.content.slice(0, 80)}
                    {q.content.length > 80 ? "…" : ""}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Tipo de relación</label>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={relId}
              onChange={(e) => setRelId(e.target.value)}
            >
              <option value="">— sin tipo —</option>
              {(relations ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Comentario (opcional)</label>
            <textarea
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!toQ || create.isPending}>Crear vínculo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
