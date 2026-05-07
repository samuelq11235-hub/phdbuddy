import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type {
  Code,
  CodeCooccurrenceRow,
  CodeDocumentMatrixRow,
  CodeNetworkResponse,
  DocumentForCodeRow,
  SharedQuotationRow,
} from "@/types/database";

export interface CodeNode extends Code {
  children: CodeNode[];
}

export function useCodes(projectId: string | undefined) {
  return useQuery({
    queryKey: ["codes", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("codes")
        .select("*")
        .eq("project_id", projectId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Code[];
    },
    enabled: !!projectId,
  });
}

export function useCodeTree(projectId: string | undefined) {
  const codes = useCodes(projectId);
  const tree = useMemo(() => buildTree(codes.data ?? []), [codes.data]);
  return { ...codes, tree };
}

export function useCreateCode() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string;
      color?: string;
      parentId?: string | null;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("codes")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name.trim(),
          description: input.description ?? null,
          color: input.color ?? colorForName(input.name),
          parent_id: input.parentId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Code;
    },
    onSuccess: (code) => {
      qc.invalidateQueries({ queryKey: ["codes", code.project_id] });
    },
  });
}

export function useUpdateCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      description?: string | null;
      color?: string;
      parent_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("codes")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Code;
    },
    onSuccess: (code) => {
      qc.invalidateQueries({ queryKey: ["codes", code.project_id] });
    },
  });
}

export function useDeleteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: Pick<Code, "id" | "project_id">) => {
      const { error } = await supabase.from("codes").delete().eq("id", code.id);
      if (error) throw error;
      return code;
    },
    onSuccess: (code) => {
      qc.invalidateQueries({ queryKey: ["codes", code.project_id] });
      qc.invalidateQueries({ queryKey: ["quotations", code.project_id] });
    },
  });
}

// Merges N source codes into a single target code (server-side via the
// merge_codes() RPC). All quotation_codes rows on the sources are
// re-pointed to the target, child codes are reparented, then the source
// codes are deleted. The target's usage_count is recomputed.
export function useMergeCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      targetCodeId: string;
      sourceCodeIds: string[];
    }) => {
      const { data, error } = await supabase.rpc("merge_codes", {
        p_target_code_id: input.targetCodeId,
        p_source_code_ids: input.sourceCodeIds,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { merged_count: number; removed_codes: number }
        | null;
      return {
        mergedCount: row?.merged_count ?? 0,
        removedCodes: row?.removed_codes ?? 0,
        projectId: input.projectId,
      };
    },
    onSuccess: ({ projectId }) => {
      qc.invalidateQueries({ queryKey: ["codes", projectId] });
      qc.invalidateQueries({ queryKey: ["quotations", projectId] });
      qc.invalidateQueries({ queryKey: ["code-cooccurrence", projectId] });
      qc.invalidateQueries({ queryKey: ["code-document-matrix", projectId] });
    },
  });
}

// Splits a code into two by moving a subset of its quotations to a
// brand-new sibling. The new code inherits the source's parent and
// color so the codebook tree stays visually coherent.
export function useSplitCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      sourceCodeId: string;
      quotationIds: string[];
      newName: string;
      newDescription?: string;
    }) => {
      const { data, error } = await supabase.rpc("split_code", {
        p_source_code_id: input.sourceCodeId,
        p_quotation_ids: input.quotationIds,
        p_new_name: input.newName,
        p_new_description: input.newDescription ?? null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { new_code_id: string; moved_count: number }
        | null;
      return {
        newCodeId: row?.new_code_id ?? null,
        movedCount: row?.moved_count ?? 0,
        projectId: input.projectId,
      };
    },
    onSuccess: ({ projectId }) => {
      qc.invalidateQueries({ queryKey: ["codes", projectId] });
      qc.invalidateQueries({ queryKey: ["quotations", projectId] });
    },
  });
}

export function useCodeCooccurrence(projectId: string | undefined) {
  return useQuery({
    queryKey: ["code-cooccurrence", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("code_cooccurrence", {
        match_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as CodeCooccurrenceRow[];
    },
    enabled: !!projectId,
  });
}

export interface CodeNetworkFilters {
  codeGroupId?: string | null;
  minWeight?: number;
  limitTopEdges?: number;
}

export function useCodeNetwork(
  projectId: string | undefined,
  filters: CodeNetworkFilters = {}
) {
  // The cooccurrence graph is derived from quotation_codes — so the
  // cache key must change whenever (a) filters change OR (b) we know the
  // upstream data changed. TanStack Query already invalidates this key
  // from useCreateQuotation / useDeleteCode etc. via the existing
  // invalidations on ["code-cooccurrence", projectId]; we mirror that
  // here so updates propagate without a manual refetch.
  return useQuery({
    queryKey: [
      "code-network",
      projectId,
      filters.codeGroupId ?? null,
      filters.minWeight ?? 1,
      filters.limitTopEdges ?? 0,
    ],
    queryFn: async (): Promise<CodeNetworkResponse> => {
      if (!projectId) {
        return {
          ok: true,
          projectId: "",
          generatedAt: new Date().toISOString(),
          stats: { nodeCount: 0, edgeCount: 0, totalQuotations: 0 },
          nodes: [],
          edges: [],
        };
      }
      return api.fetchCodeNetwork({
        projectId,
        codeGroupId: filters.codeGroupId ?? undefined,
        minWeight: filters.minWeight,
        limitTopEdges: filters.limitTopEdges,
      });
    },
    enabled: !!projectId,
    staleTime: 1000 * 30,
  });
}

export function useSharedQuotations(
  projectId: string | undefined,
  codeA: string | null | undefined,
  codeB: string | null | undefined
) {
  return useQuery({
    queryKey: ["shared-quotations", projectId, codeA, codeB],
    queryFn: async () => {
      if (!projectId || !codeA || !codeB) return [] as SharedQuotationRow[];
      const { data, error } = await supabase.rpc("shared_quotations_for_code_pair", {
        p_project_id: projectId,
        p_code_a: codeA,
        p_code_b: codeB,
      });
      if (error) throw error;
      return (data ?? []) as SharedQuotationRow[];
    },
    enabled: !!projectId && !!codeA && !!codeB,
  });
}

export function useDocumentsForCode(
  projectId: string | undefined,
  codeId: string | null | undefined
) {
  return useQuery({
    queryKey: ["documents-for-code", projectId, codeId],
    queryFn: async () => {
      if (!projectId || !codeId) return [] as DocumentForCodeRow[];
      const { data, error } = await supabase.rpc("documents_for_code", {
        p_project_id: projectId,
        p_code_id: codeId,
      });
      if (error) throw error;
      return (data ?? []) as DocumentForCodeRow[];
    },
    enabled: !!projectId && !!codeId,
  });
}

export function useCodeDocumentMatrix(projectId: string | undefined) {
  return useQuery({
    queryKey: ["code-document-matrix", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("code_document_matrix", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as CodeDocumentMatrixRow[];
    },
    enabled: !!projectId,
  });
}

function buildTree(codes: Code[]): CodeNode[] {
  const byId = new Map<string, CodeNode>();
  for (const c of codes) byId.set(c.id, { ...c, children: [] });
  const roots: CodeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const PALETTE = [
  "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#EC4899", "#14B8A6", "#8B5CF6", "#6366F1", "#F97316",
  "#84CC16", "#06B6D4",
];

export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
