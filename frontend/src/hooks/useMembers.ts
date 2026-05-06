import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type {
  InvitableRole,
  ProjectInvitation,
  ProjectMember,
  ProjectMemberWithProfile,
  ProjectRole,
} from "@/types/database";

// -----------------------------------------------------
// Membership of the current user
// -----------------------------------------------------
// Used everywhere we need to gate UI actions — kept light and aggressively
// cached so dozens of components can call it without hammering the DB.

export function useMyRole(projectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-role", projectId, user?.id],
    queryFn: async (): Promise<ProjectRole | null> => {
      if (!projectId || !user) return null;
      const { data, error } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as ProjectRole | undefined) ?? null;
    },
    enabled: !!projectId && !!user,
    staleTime: 1000 * 60 * 5,
  });
}

export function canWrite(role: ProjectRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "coder";
}

export function canAdmin(role: ProjectRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwner(role: ProjectRole | null | undefined): boolean {
  return role === "owner";
}

// -----------------------------------------------------
// All members of a project (with profile join)
// -----------------------------------------------------
// PostgREST can't auto-detect a relationship between project_members and
// profiles because they share auth.users as a target FK rather than a
// direct one — so we issue two queries and merge in JS. Cheap because
// member lists are short (typically < 20).

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-members", projectId],
    queryFn: async (): Promise<ProjectMemberWithProfile[]> => {
      if (!projectId) return [];

      const { data: members, error: mErr } = await supabase
        .from("project_members")
        .select("id, project_id, user_id, role, created_at, updated_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (mErr) throw mErr;
      const memberList = (members ?? []) as ProjectMember[];
      if (memberList.length === 0) return [];

      const userIds = memberList.map((m) => m.user_id);
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);
      if (pErr) throw pErr;
      const profileById = new Map(
        (profiles ?? []).map((p: { id: string; full_name: string | null; avatar_url: string | null }) => [p.id, p])
      );

      return memberList.map((m) => ({
        ...m,
        profile: profileById.get(m.user_id) ?? null,
        email: null,
      }));
    },
    enabled: !!projectId,
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; role: ProjectRole }) => {
      const { data, error } = await supabase
        .from("project_members")
        .update({ role: input.role })
        .eq("id", input.memberId)
        .select()
        .single();
      if (error) throw error;
      return data as ProjectMember;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["project-members", m.project_id] });
      qc.invalidateQueries({ queryKey: ["my-role", m.project_id] });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (member: Pick<ProjectMember, "id" | "project_id" | "user_id">) => {
      const { error } = await supabase
        .from("project_members")
        .delete()
        .eq("id", member.id);
      if (error) throw error;
      return member;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["project-members", m.project_id] });
      qc.invalidateQueries({ queryKey: ["my-role", m.project_id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// -----------------------------------------------------
// Invitations
// -----------------------------------------------------

export function useProjectInvitations(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-invitations", projectId],
    queryFn: async (): Promise<ProjectInvitation[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("project_invitations")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProjectInvitation[];
    },
    enabled: !!projectId,
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      email: string;
      role: InvitableRole;
    }) => {
      const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const resp = await api.sendInvitation({
        projectId: input.projectId,
        email: input.email,
        role: input.role,
        appOrigin,
      });
      return resp;
    },
    onSuccess: (_resp, vars) => {
      qc.invalidateQueries({ queryKey: ["project-invitations", vars.projectId] });
    },
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invite: Pick<ProjectInvitation, "id" | "project_id">) => {
      const { error } = await supabase
        .from("project_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", invite.id);
      if (error) throw error;
      return invite;
    },
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: ["project-invitations", i.project_id] });
    },
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      return await api.acceptInvitation({ token });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
