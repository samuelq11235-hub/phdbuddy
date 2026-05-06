import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  DocumentAttributeSchema,
  DocumentGroup,
  DocumentGroupMember,
} from "@/types/database";

// ----------------- groups ----------------

export function useDocumentGroups(projectId: string | undefined) {
  return useQuery({
    queryKey: ["document-groups", projectId],
    queryFn: async (): Promise<DocumentGroup[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("document_groups")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as DocumentGroup[];
    },
    enabled: !!projectId,
  });
}

export function useCreateDocumentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string | null;
      color?: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("document_groups")
        .insert({
          project_id: input.projectId,
          user_id: user.id,
          name: input.name,
          description: input.description ?? null,
          color: input.color ?? "#6366F1",
        })
        .select()
        .single();
      if (error) throw error;
      return data as DocumentGroup;
    },
    onSuccess: (g) => qc.invalidateQueries({ queryKey: ["document-groups", g.project_id] }),
  });
}

export function useUpdateDocumentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
      patch: Partial<Pick<DocumentGroup, "name" | "description" | "color">>;
    }) => {
      const { error } = await supabase
        .from("document_groups")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (i) => qc.invalidateQueries({ queryKey: ["document-groups", i.projectId] }),
  });
}

export function useDeleteDocumentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; projectId: string }) => {
      const { error } = await supabase.from("document_groups").delete().eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (i) => qc.invalidateQueries({ queryKey: ["document-groups", i.projectId] }),
  });
}

// ----------------- group ↔ document membership ----------------

export function useDocumentGroupMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: ["document-group-members", groupId],
    queryFn: async (): Promise<DocumentGroupMember[]> => {
      if (!groupId) return [];
      const { data, error } = await supabase
        .from("document_group_members")
        .select("*")
        .eq("document_group_id", groupId);
      if (error) throw error;
      return (data ?? []) as DocumentGroupMember[];
    },
    enabled: !!groupId,
  });
}

export function useAddDocumentsToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; documentIds: string[] }) => {
      if (input.documentIds.length === 0) return input;
      const rows = input.documentIds.map((id) => ({
        document_group_id: input.groupId,
        document_id: id,
      }));
      const { error } = await supabase
        .from("document_group_members")
        .upsert(rows, { onConflict: "document_group_id,document_id", ignoreDuplicates: true });
      if (error) throw error;
      return input;
    },
    onSuccess: (i) => qc.invalidateQueries({ queryKey: ["document-group-members", i.groupId] }),
  });
}

export function useRemoveDocumentFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; documentId: string }) => {
      const { error } = await supabase
        .from("document_group_members")
        .delete()
        .eq("document_group_id", input.groupId)
        .eq("document_id", input.documentId);
      if (error) throw error;
      return input;
    },
    onSuccess: (i) => qc.invalidateQueries({ queryKey: ["document-group-members", i.groupId] }),
  });
}

// ----------------- attribute schema ----------------

export function useDocumentAttributeSchema(projectId: string | undefined) {
  return useQuery({
    queryKey: ["document-attribute-schema", projectId],
    queryFn: async (): Promise<DocumentAttributeSchema[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("document_attribute_schema")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocumentAttributeSchema[];
    },
    enabled: !!projectId,
  });
}

export function useCreateAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      data_type: DocumentAttributeSchema["data_type"];
      options?: string[] | null;
      description?: string | null;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("document_attribute_schema")
        .insert({
          project_id: input.projectId,
          user_id: user.id,
          name: input.name,
          data_type: input.data_type,
          options: input.options ?? null,
          description: input.description ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DocumentAttributeSchema;
    },
    onSuccess: (a) => qc.invalidateQueries({ queryKey: ["document-attribute-schema", a.project_id] }),
  });
}

export function useDeleteAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("document_attribute_schema")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (i) =>
      qc.invalidateQueries({ queryKey: ["document-attribute-schema", i.projectId] }),
  });
}
