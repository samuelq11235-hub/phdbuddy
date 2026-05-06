import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { QueryNode, SavedQuery } from "@/types/database";

export function useSavedQueries(projectId: string | undefined) {
  return useQuery({
    queryKey: ["saved-queries", projectId],
    queryFn: async (): Promise<SavedQuery[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("saved_queries")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SavedQuery[];
    },
    enabled: !!projectId,
  });
}

export function useSaveQuery() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string;
      definition: QueryNode;
      id?: string;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      if (input.id) {
        const { error } = await supabase
          .from("saved_queries")
          .update({
            name: input.name,
            description: input.description ?? null,
            definition: input.definition,
          })
          .eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from("saved_queries")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name,
          description: input.description ?? null,
          definition: input.definition,
        })
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: ["saved-queries", vars.projectId] });
    },
  });
}

export function useDeleteSavedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; projectId: string }) => {
      const { error } = await supabase.from("saved_queries").delete().eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      qc.invalidateQueries({ queryKey: ["saved-queries", input.projectId] });
    },
  });
}

export function useExecuteQuery() {
  return useMutation({
    mutationFn: (args: { projectId: string; query: QueryNode }) =>
      api.executeQuery(args),
  });
}

// Smart code: creates a code linked to a saved_query via
// codes.smart_query_id (F18). Quotation membership is *not* materialised
// — the UI resolves it live by running the query.
export function useCreateSmartCode() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      definition: QueryNode;
      description?: string;
      color?: string;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data: q, error: qErr } = await supabase
        .from("saved_queries")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name,
          description: input.description ?? "Smart code",
          definition: input.definition,
        })
        .select("id")
        .single();
      if (qErr) throw qErr;
      const queryId = (q as { id: string }).id;
      const { data: c, error: cErr } = await supabase
        .from("codes")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name,
          description: input.description ?? "Smart code (membresía dinámica)",
          color: input.color ?? "#06B6D4",
          smart_query_id: queryId,
        })
        .select()
        .single();
      if (cErr) throw cErr;
      return c;
    },
    onSuccess: (_c, vars) => {
      qc.invalidateQueries({ queryKey: ["codes", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["saved-queries", vars.projectId] });
    },
  });
}

// "Convertir resultado en código": creates a new code with `name` and
// applies it (via quotation_codes) to every quotation_id passed.
export function useApplyResultsAsCode() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      codeName: string;
      quotationIds: string[];
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data: codeRow, error: codeErr } = await supabase
        .from("codes")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.codeName,
          color: "#7C3AED",
          created_by_ai: false,
        })
        .select("id")
        .single();
      if (codeErr) throw codeErr;
      const codeId = (codeRow as { id: string }).id;

      if (input.quotationIds.length > 0) {
        const rows = input.quotationIds.map((qid) => ({
          quotation_id: qid,
          code_id: codeId,
          user_id: user.id,
        }));
        // Bulk insert; ignore duplicate-key errors so re-running on
        // overlapping result sets stays idempotent.
        const { error: insErr } = await supabase
          .from("quotation_codes")
          .upsert(rows, { onConflict: "quotation_id,code_id", ignoreDuplicates: true });
        if (insErr && !insErr.message.toLowerCase().includes("duplicate")) {
          throw insErr;
        }
      }
      return { codeId, count: input.quotationIds.length };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["codes", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["quotations", vars.projectId] });
    },
  });
}
