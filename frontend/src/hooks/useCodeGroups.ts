import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { colorForName } from "@/hooks/useCodes";
import type { CodeGroup, CodeGroupMember } from "@/types/database";

export function useCodeGroups(projectId: string | undefined) {
  return useQuery({
    queryKey: ["code-groups", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("code_groups")
        .select("*")
        .eq("project_id", projectId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as CodeGroup[];
    },
    enabled: !!projectId,
  });
}

export function useCodeGroupMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ["code-group-members", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      // Filter membership rows down to the current project by joining through
      // `code_groups`, which carries `project_id`. RLS additionally guarantees
      // we only see rows owned by the current user.
      const { data, error } = await supabase
        .from("code_group_members")
        .select(
          "code_id, code_group_id, user_id, created_at, code_groups!inner(project_id)"
        )
        .eq("code_groups.project_id", projectId);
      if (error) throw error;
      // The supabase-js types inference for embedded resources is brittle, so
      // we cast through `unknown` to a narrow shape before stripping the
      // helper column.
      const rows = (data ?? []) as unknown as Array<
        CodeGroupMember & { code_groups?: unknown }
      >;
      return rows.map(({ code_groups: _ignored, ...rest }) => rest as CodeGroupMember);
    },
    enabled: !!projectId,
  });
}

export interface CodeGroupsIndex {
  groupsByCode: Map<string, string[]>;
  codesByGroup: Map<string, string[]>;
}

export function useCodeGroupsIndex(projectId: string | undefined): CodeGroupsIndex {
  const { data: members } = useCodeGroupMembers(projectId);
  return useMemo(() => buildIndex(members ?? []), [members]);
}

function buildIndex(members: CodeGroupMember[]): CodeGroupsIndex {
  const groupsByCode = new Map<string, string[]>();
  const codesByGroup = new Map<string, string[]>();
  for (const m of members) {
    const gs = groupsByCode.get(m.code_id) ?? [];
    gs.push(m.code_group_id);
    groupsByCode.set(m.code_id, gs);

    const cs = codesByGroup.get(m.code_group_id) ?? [];
    cs.push(m.code_id);
    codesByGroup.set(m.code_group_id, cs);
  }
  return { groupsByCode, codesByGroup };
}

export function useCreateCodeGroup() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string;
      color?: string;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("code_groups")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name.trim(),
          description: input.description ?? null,
          color: input.color ?? colorForName(input.name),
        })
        .select()
        .single();
      if (error) throw error;
      return data as CodeGroup;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["code-groups", group.project_id] });
    },
  });
}

export function useUpdateCodeGroup() {
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
    }) => {
      const { data, error } = await supabase
        .from("code_groups")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CodeGroup;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["code-groups", group.project_id] });
    },
  });
}

export function useDeleteCodeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (group: Pick<CodeGroup, "id" | "project_id">) => {
      const { error } = await supabase
        .from("code_groups")
        .delete()
        .eq("id", group.id);
      if (error) throw error;
      return group;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["code-groups", group.project_id] });
      qc.invalidateQueries({ queryKey: ["code-group-members", group.project_id] });
    },
  });
}

export function useAddCodesToGroup() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      groupId: string;
      codeIds: string[];
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      if (input.codeIds.length === 0) return [];
      const rows = input.codeIds.map((codeId) => ({
        code_id: codeId,
        code_group_id: input.groupId,
        user_id: user.id,
      }));
      // Upsert avoids errors when a code is already in the group.
      const { data, error } = await supabase
        .from("code_group_members")
        .upsert(rows, { onConflict: "code_id,code_group_id", ignoreDuplicates: true })
        .select();
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["code-group-members", vars.projectId] });
    },
  });
}

export function useRemoveCodeFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      groupId: string;
      codeId: string;
    }) => {
      const { error } = await supabase
        .from("code_group_members")
        .delete()
        .eq("code_id", input.codeId)
        .eq("code_group_id", input.groupId);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      qc.invalidateQueries({ queryKey: ["code-group-members", input.projectId] });
    },
  });
}

export function useSetCodeGroups() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      codeId: string;
      groupIds: string[];
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      // Replace the set of groups for a single code: delete existing then re-insert.
      const { error: delErr } = await supabase
        .from("code_group_members")
        .delete()
        .eq("code_id", input.codeId);
      if (delErr) throw delErr;
      if (input.groupIds.length === 0) return [];
      const rows = input.groupIds.map((groupId) => ({
        code_id: input.codeId,
        code_group_id: groupId,
        user_id: user.id,
      }));
      const { data, error } = await supabase
        .from("code_group_members")
        .insert(rows)
        .select();
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["code-group-members", vars.projectId] });
    },
  });
}
