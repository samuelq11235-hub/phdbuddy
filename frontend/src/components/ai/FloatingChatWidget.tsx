import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Sparkles,
  Trash2,
  Plus,
  Loader2,
  MessageSquare,
  Quote,
  X,
  Minus,
  ChevronDown,
  Bot,
  User as UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useChatMessages,
  useChatSessions,
  useDeleteChatSession,
  useSendChat,
} from "@/hooks/useChat";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ChatCitation, ChatMessage } from "@/types/database";

const STORAGE_OPEN_PREFIX = "phdbuddy:chat:open:";
const STORAGE_SESSION_PREFIX = "phdbuddy:chat:session:";

export function FloatingChatWidget({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_OPEN_PREFIX + projectId) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_OPEN_PREFIX + projectId,
      open ? "1" : "0"
    );
  }, [open, projectId]);

  return (
    <>
      {open ? (
        <ChatCard
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir chat con PHDBuddy"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Sparkles className="h-6 w-6" />
          <span className="sr-only">Chat IA</span>
        </button>
      )}
    </>
  );
}

function ChatCard({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { data: sessions } = useChatSessions(projectId);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      const stored = window.localStorage.getItem(
        STORAGE_SESSION_PREFIX + projectId
      );
      return stored ?? undefined;
    }
  );
  const { data: messages } = useChatMessages(activeSessionId);
  const send = useSendChat();
  const deleteSession = useDeleteChatSession();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Validate the stored sessionId still belongs to this project — otherwise
  // pick the most recent.
  useEffect(() => {
    if (!sessions) return;
    if (sessions.length === 0) {
      setActiveSessionId(undefined);
      return;
    }
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeSessionId) {
      window.localStorage.setItem(
        STORAGE_SESSION_PREFIX + projectId,
        activeSessionId
      );
    } else {
      window.localStorage.removeItem(STORAGE_SESSION_PREFIX + projectId);
    }
  }, [activeSessionId, projectId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages?.length, send.isPending]);

  // Auto-grow textarea (max 5 lines).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 140;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, [input]);

  async function handleSend() {
    const q = input.trim();
    if (!q || send.isPending) return;
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

  const activeSession = useMemo(
    () => sessions?.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const showEmpty =
    !activeSessionId && (!messages || messages.length === 0) && !send.isPending;

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl",
        "bottom-4 right-4 left-4 top-4",
        "sm:left-auto sm:top-auto sm:bottom-6 sm:right-6 sm:h-[640px] sm:max-h-[calc(100vh-3rem)] sm:w-[420px]"
      )}
      role="dialog"
      aria-label="Chat IA"
    >
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-tight">
            PHDBuddy
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {activeSession?.title ?? "Nueva conversación"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Conversaciones"
              title="Conversaciones"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
            <DropdownMenuLabel>Conversaciones</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setActiveSessionId(undefined);
              }}
              className="font-medium"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva conversación
            </DropdownMenuItem>
            {sessions && sessions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      setActiveSessionId(s.id);
                    }}
                    className="group flex items-center gap-2"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    <span
                      className={cn(
                        "flex-1 truncate text-sm",
                        activeSessionId === s.id && "font-semibold text-primary"
                      )}
                    >
                      {s.title}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `¿Eliminar conversación "${s.title}"?`
                          )
                        ) {
                          deleteSession.mutate(s, {
                            onSuccess: () => {
                              if (activeSessionId === s.id) {
                                setActiveSessionId(undefined);
                              }
                            },
                          });
                        }
                      }}
                      className="rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Minimizar"
          title="Minimizar"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 sm:hidden"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto bg-muted/10 px-4 py-4"
      >
        {showEmpty ? (
          <EmptyChat onPick={(t) => setInput(t)} />
        ) : (
          <>
            {messages?.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {send.isPending && <ThinkingBubble />}
          </>
        )}
      </div>

      {/* Composer */}
      <form
        className="border-t border-border bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            placeholder="Pregunta sobre tus datos..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            className="max-h-[140px] min-h-[40px] resize-none text-sm leading-snug"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || send.isPending}
            className="h-10 w-10 shrink-0"
            aria-label="Enviar"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Enter para enviar · Shift+Enter para salto de línea
        </p>
      </form>
    </div>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const examples = [
    "¿Cuáles son los temas principales en este proyecto?",
    "Resume las tensiones clave en estas entrevistas.",
    "¿Dónde se menciona la autonomía de forma positiva?",
    "Compara lo que dicen las personas jóvenes y mayores.",
  ];
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">Conversa con tu proyecto</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Pregunta lo que quieras. Te responderé citando las piezas exactas de
        tus datos. Si no encuentro evidencia, te lo diré.
      </p>
      <div className="mt-4 grid w-full gap-1.5">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const time = formatTime(message.created_at);
  return (
    <div
      className={cn(
        "flex w-full items-start gap-2",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isUser
            ? "bg-primary/15 text-primary"
            : "bg-foreground/10 text-foreground"
        )}
        aria-hidden
      >
        {isUser ? (
          <UserIcon className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={cn(
          "flex max-w-[82%] flex-col",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
            "[&_p]:m-0",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-border bg-card text-foreground"
          )}
        >
          <RenderedAnswer
            text={message.content}
            citations={message.citations ?? []}
            isUser={isUser}
          />
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span>{time}</span>
          {!isUser && message.citations && message.citations.length > 0 && (
            <CitationsToggle citations={message.citations} />
          )}
        </div>
      </div>
    </div>
  );
}

function CitationsToggle({ citations }: { citations: ChatCitation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:bg-primary/15"
      >
        {citations.length} {citations.length === 1 ? "cita" : "citas"}
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <ol className="absolute left-9 right-3 mt-6 max-w-[320px] space-y-1.5 rounded-md border border-border bg-card p-2 shadow-md">
          {citations.map((c, i) => (
            <Citation key={i} c={c} />
          ))}
        </ol>
      )}
    </>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/10">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
      </div>
    </div>
  );
}

function Citation({ c }: { c: ChatCitation }) {
  return (
    <li className="rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        <Quote className="h-3 w-3" />
        <span>{c.ref ?? ""}</span>
        <span className="text-muted-foreground">·</span>
        <span className="truncate font-normal text-muted-foreground">
          {c.document_title ?? "(documento)"}
        </span>
        <span className="ml-auto whitespace-nowrap font-mono text-muted-foreground">
          {Math.round(c.similarity * 100)}%
        </span>
      </div>
      <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
        {c.content}
      </p>
    </li>
  );
}

function RenderedAnswer({
  text,
  citations,
  isUser,
}: {
  text: string;
  citations: ChatCitation[];
  isUser: boolean;
}) {
  // Inline citation refs as small badges, preserving newlines.
  const refMap = new Map(citations.map((c) => [c.ref, c]));
  const parts = text.split(/(\[(?:Q|C)\d+\])/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        const m = part.match(/^\[((?:Q|C)\d+)\]$/);
        if (m) {
          const ref = m[1];
          const cit = refMap.get(ref);
          return (
            <span
              key={i}
              className={cn(
                "mx-0.5 inline-flex items-center rounded-full px-1.5 py-px align-baseline text-[10px] font-semibold",
                isUser
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-primary/10 text-primary"
              )}
              title={cit?.content ?? undefined}
            >
              {ref}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
