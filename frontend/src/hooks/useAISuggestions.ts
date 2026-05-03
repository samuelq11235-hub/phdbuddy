import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type {
  AISuggestion,
  CodebookSuggestionPayload,
  ThemeSuggestionPayload,
} from "@/types/database";

export function useSuggestions(projectId: string | undefined) {
  return useQuery({
    queryKey: ["suggestions", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AISuggestion[];
    },
    enabled: !!projectId,
  });
}

export function useDocumentSuggestions(documentId: string | undefined) {
  return useQuery({
    queryKey: ["doc-suggestions", documentId],
    queryFn: async () => {
      if (!documentId) return [];
      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("*")
        .eq("document_id", documentId)
        .eq("kind", "codebook")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AISuggestion<CodebookSuggestionPayload>[];
    },
    enabled: !!documentId,
  });
}

export function useThemeSuggestions(projectId: string | undefined) {
  return useQuery({
    queryKey: ["theme-suggestions", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", "theme")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AISuggestion<ThemeSuggestionPayload>[];
    },
    enabled: !!projectId,
  });
}

export function useAutoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => api.autoCode(documentId),
    onSuccess: (_data, documentId) => {
      qc.invalidateQueries({ queryKey: ["doc-suggestions", documentId] });
    },
  });
}

export function useApplySuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      suggestionId: string;
      acceptedCodeNames?: string[];
      acceptedQuotationIndices?: number[];
    }) => api.applySuggestion(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-suggestions"] });
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      qc.invalidateQueries({ queryKey: ["codes"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["document-quotations"] });
    },
  });
}

export function useRejectSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await supabase
        .from("ai_suggestions")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .eq("id", suggestionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-suggestions"] });
      qc.invalidateQueries({ queryKey: ["suggestions"] });
    },
  });
}

export function useClusterThemes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, threshold }: { projectId: string; threshold?: number }) =>
      api.clusterThemes(projectId, threshold),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["theme-suggestions", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["suggestions", vars.projectId] });
    },
  });
}
