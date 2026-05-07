import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import {
  useCreateEntityComment,
  useDeleteEntityComment,
  useEntityComments,
  useResolveEntityComment,
} from "@/hooks/useEntityComments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { LinkEntityType } from "@/types/database";

/**
 * Compact threaded comments component — embeds inside any drawer or
 * card for a code/quotation/memo/document. Renders as a flat list of
 * comments with a reply box at the bottom; threading is supported by
 * the schema but flat is sufficient for 99% of qualitative review
 * use-cases (the underlying parent_comment_id stays available for a
 * future "reply" UI).
 */
export function CommentsThread({
  projectId,
  entityType,
  entityId,
}: {
  projectId: string;
  entityType: LinkEntityType;
  entityId: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: comments = [], isLoading } = useEntityComments(
    projectId,
    entityType,
    entityId
  );
  const create = useCreateEntityComment();
  const remove = useDeleteEntityComment();
  const resolve = useResolveEntityComment();

  const [draft, setDraft] = useState("");

  async function handleSubmit() {
    const body = draft.trim();
    if (body.length === 0) return;
    try {
      await create.mutateAsync({ projectId, entityType, entityId, body });
      setDraft("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo publicar el comentario",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este comentario?")) return;
    try {
      await remove.mutateAsync({
        id,
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleToggleResolve(id: string, resolved: boolean) {
    try {
      await resolve.mutateAsync({
        id,
        resolved,
        projectId,
        entityType,
        entityId,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo cambiar el estado",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <section>
      <header className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        Comentarios
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal">
          {comments.length}
        </span>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando hilo…
        </div>
      ) : comments.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
          Aún no hay comentarios. Inicia la conversación abajo.
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const mine = user?.id === c.user_id;
            return (
              <li
                key={c.id}
                className={
                  "rounded-lg border p-2.5 text-sm " +
                  (c.resolved ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-card")
                }
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                  <span>
                    {mine ? "Tú" : c.user_id.slice(0, 8)} ·{" "}
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleResolve(c.id, !c.resolved)}
                      className={
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-muted " +
                        (c.resolved ? "text-emerald-600" : "text-muted-foreground")
                      }
                      title={c.resolved ? "Reabrir" : "Marcar como resuelto"}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {c.resolved ? "Resuelto" : "Resolver"}
                    </button>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="inline-flex items-center rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap leading-snug">{c.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex items-end gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe un comentario… (Cmd+Enter para enviar)"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={create.isPending || draft.trim().length === 0}
          className="self-end"
        >
          {create.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </section>
  );
}
