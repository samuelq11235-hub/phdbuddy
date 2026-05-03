import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Memo, MemoType } from "@/types/database";

export function useMemos(projectId: string | undefined) {
  return useQuery({
    queryKey: ["memos", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("memos")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Memo[];
    },
    enabled: !!projectId,
  });
}

export function useMemoById(memoId: string | undefined) {
  return useQuery({
    queryKey: ["memo", memoId],
    queryFn: async () => {
      if (!memoId) return null;
      const { data, error } = await supabase
        .from("memos")
        .select("*")
        .eq("id", memoId)
        .maybeSingle();
      if (error) throw error;
      return data as Memo | null;
    },
    enabled: !!memoId,
  });
}

export function useCreateMemo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      title: string;
      content?: string;
      kind?: MemoType;
      linkedCodeIds?: string[];
      linkedQuotationIds?: string[];
      linkedDocumentIds?: string[];
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("memos")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          title: input.title.trim(),
          content: input.content ?? "",
          kind: input.kind ?? "analytic",
          linked_code_ids: input.linkedCodeIds ?? [],
          linked_quotation_ids: input.linkedQuotationIds ?? [],
          linked_document_ids: input.linkedDocumentIds ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      return data as Memo;
    },
    onSuccess: (memo) => {
      qc.invalidateQueries({ queryKey: ["memos", memo.project_id] });
    },
  });
}

export function useUpdateMemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      title?: string;
      content?: string;
      kind?: MemoType;
    }) => {
      const { data, error } = await supabase
        .from("memos")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Memo;
    },
    onSuccess: (memo) => {
      qc.invalidateQueries({ queryKey: ["memos", memo.project_id] });
      qc.invalidateQueries({ queryKey: ["memo", memo.id] });
    },
  });
}

export function useDeleteMemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memo: Pick<Memo, "id" | "project_id">) => {
      const { error } = await supabase.from("memos").delete().eq("id", memo.id);
      if (error) throw error;
      return memo;
    },
    onSuccess: (memo) => {
      qc.invalidateQueries({ queryKey: ["memos", memo.project_id] });
    },
  });
}
