import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Code, CodeCooccurrenceRow, CodeDocumentMatrixRow } from "@/types/database";

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
