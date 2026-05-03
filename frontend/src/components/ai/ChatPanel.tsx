import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Trash2, Plus, Loader2, MessageSquare, Quote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatMessages, useChatSessions, useDeleteChatSession, useSendChat } from "@/hooks/useChat";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ChatCitation, ChatMessage } from "@/types/database";

export function ChatPanel({ projectId }: { projectId: string }) {
  const { data: sessions } = useChatSessions(projectId);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const { data: messages } = useChatMessages(activeSessionId);
  const send = useSendChat();
  const deleteSession = useDeleteChatSession();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // When sessions arrive and none selected, pick the most recent.
  useEffect(() => {
    if (!activeSessionId && sessions && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages?.length, send.isPending]);

  async function handleSend() {
    const q = input.trim();
    if (!q) return;
    setInput("");
    try {
      const resp = await send.mutateAsync({
        projectId,
        sessionId: activeSessionId,
        question: q,
      });
      setActiveSessionId(resp.sessionId);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el chat",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="grid h-[calc(100vh-12rem)] grid-cols-[260px_1fr] overflow-hidden rounded-xl border bg-card">
      <aside className="flex flex-col border-r bg-muted/20">
        <div className="flex items-center justify-between border-b p-3">
          <h3 className="text-sm font-semibold">Conversaciones</h3>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setActiveSessionId(undefined)}
            aria-label="Nueva conversación"
            title="Nueva conversación"
            className="h-7 w-7"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessions && sessions.length > 0 ? (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id} className="group relative">
                  <button
                    onClick={() => setActiveSessionId(s.id)}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-2 text-left text-sm transition-colors",
                      activeSessionId === s.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/40"
                    )}
                  >
                    <MessageSquare className="mr-1 inline h-3 w-3 opacity-50" />
                    {s.title}
                  </button>
                  <button
                    onClick={() => deleteSession.mutate(s)}
                    className="absolute right-1 top-1.5 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-4 text-xs text-muted-foreground">Aún no hay conversaciones.</p>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
          {!activeSessionId && (!messages || messages.length === 0) ? (
            <EmptyChat />
          ) : (
            <ul className="mx-auto max-w-2xl space-y-6">
              {messages?.map((m) => <MessageItem key={m.id} message={m} />)}
              {send.isPending && (
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  PHDBuddy está leyendo tu proyecto…
                </li>
              )}
            </ul>
          )}
        </div>

        <form
          className="border-t bg-background/80 p-3 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Textarea
              placeholder="Pregunta lo que quieras sobre tu proyecto: citas, temas, comparaciones..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              className="min-h-[60px] resize-none"
            />
            <Button type="submit" disabled={!input.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyChat() {
  const examples = [
    "¿Cuáles son los temas principales sobre el agotamiento emocional?",
    "Compara lo que dicen las personas participantes jóvenes y mayores sobre X.",
    "¿Dónde se menciona la autonomía de forma positiva?",
    "Resume las tensiones clave en estas entrevistas.",
  ];
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">Conversa con tu proyecto</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Haz preguntas sobre tus datos y obtén respuestas citadas a citas y pasajes específicos.
        PHDBuddy nunca inventa &mdash; si no encuentra evidencia, te lo dirá.
      </p>
      <div className="mt-6 grid w-full gap-2 text-sm">
        {examples.map((ex) => (
          <div
            key={ex}
            className="rounded-md border bg-muted/20 px-3 py-2 text-left text-muted-foreground"
          >
            “{ex}”
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "border bg-muted/20"
        )}
      >
        <RenderedAnswer text={message.content} citations={message.citations} />
      </div>
      {!isUser && message.citations && message.citations.length > 0 && (
        <details className="max-w-[85%] w-full text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium hover:text-foreground">
            {message.citations.length} {message.citations.length === 1 ? "cita" : "citas"}
          </summary>
          <ol className="mt-2 space-y-2">
            {message.citations.map((c, i) => (
              <Citation key={i} c={c} />
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function Citation({ c }: { c: ChatCitation }) {
  return (
    <li className="rounded-md border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        <Quote className="h-3 w-3" />
        {c.ref ?? ""}
        <span className="text-muted-foreground">·</span>
        <span className="font-normal text-muted-foreground">
          {c.document_title ?? "(documento)"}
        </span>
        <span className="ml-auto text-muted-foreground">
          {Math.round(c.similarity * 100)}%
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-xs leading-relaxed">{c.content}</p>
    </li>
  );
}

function RenderedAnswer({ text, citations }: { text: string; citations: ChatCitation[] }) {
  // Render citation refs like [Q3] or [C2] as small badges.
  const refMap = new Map(citations.map((c) => [c.ref, c]));
  const parts = text.split(/(\[(?:Q|C)\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[((?:Q|C)\d+)\]$/);
        if (m) {
          const ref = m[1];
          const cit = refMap.get(ref);
          return (
            <span
              key={i}
              className="mx-0.5 inline-block rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
              title={cit?.content}
            >
              {ref}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
