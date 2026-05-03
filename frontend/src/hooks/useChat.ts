import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { ChatMessage, ChatSession } from "@/types/database";

export function useChatSessions(projectId: string | undefined) {
  return useQuery({
    queryKey: ["chat-sessions", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as ChatSession[];
    },
    enabled: !!projectId,
  });
}

export function useChatMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["chat-messages", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: !!sessionId,
  });
}

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { projectId: string; sessionId?: string; question: string }) => {
      return await api.chat(args);
    },
    onSuccess: (resp, vars) => {
      qc.invalidateQueries({ queryKey: ["chat-messages", resp.sessionId] });
      qc.invalidateQueries({ queryKey: ["chat-sessions", vars.projectId] });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (session: Pick<ChatSession, "id" | "project_id">) => {
      const { error } = await supabase.from("chat_sessions").delete().eq("id", session.id);
      if (error) throw error;
      return session;
    },
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ["chat-sessions", session.project_id] });
    },
  });
}
