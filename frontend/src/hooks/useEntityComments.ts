import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { EntityComment, LinkEntityType } from "@/types/database";

export function useEntityComments(
  projectId: string | undefined,
  entityType: LinkEntityType | undefined,
  entityId: string | undefined
) {
  return useQuery({
    queryKey: ["entity-comments", projectId, entityType, entityId],
    queryFn: async () => {
      if (!projectId || !entityType || !entityId) return [];
      const { data, error } = await supabase
        .from("entity_comments")
        .select("*")
        .eq("project_id", projectId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EntityComment[];
    },
    enabled: !!projectId && !!entityType && !!entityId,
  });
}

export function useCreateEntityComment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      entityType: LinkEntityType;
      entityId: string;
      body: string;
      parentCommentId?: string | null;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("entity_comments")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          entity_type: input.entityType,
          entity_id: input.entityId,
          body: input.body,
          parent_comment_id: input.parentCommentId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as EntityComment;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({
        queryKey: ["entity-comments", c.project_id, c.entity_type, c.entity_id],
      });
    },
  });
}

export function useDeleteEntityComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Pick<EntityComment, "id" | "project_id" | "entity_type" | "entity_id">) => {
      const { error } = await supabase.from("entity_comments").delete().eq("id", c.id);
      if (error) throw error;
      return c;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({
        queryKey: ["entity-comments", c.project_id, c.entity_type, c.entity_id],
      });
    },
  });
}

export function useResolveEntityComment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      resolved: boolean;
      projectId: string;
      entityType: LinkEntityType;
      entityId: string;
    }) => {
      const { error } = await supabase
        .from("entity_comments")
        .update({
          resolved: input.resolved,
          resolved_at: input.resolved ? new Date().toISOString() : null,
          resolved_by: input.resolved ? user?.id ?? null : null,
        })
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (i) => {
      qc.invalidateQueries({
        queryKey: ["entity-comments", i.projectId, i.entityType, i.entityId],
      });
    },
  });
}
