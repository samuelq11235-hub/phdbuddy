import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type {
  Link,
  LinkEntityType,
  Network,
  NetworkLayout,
  RelationType,
} from "@/types/database";

// =====================================================
// networks
// =====================================================

export function useNetworks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["networks", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("networks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Network[];
    },
    enabled: !!projectId,
  });
}

export function useNetwork(networkId: string | undefined) {
  return useQuery({
    queryKey: ["network", networkId],
    queryFn: async () => {
      if (!networkId) return null;
      const { data, error } = await supabase
        .from("networks")
        .select("*")
        .eq("id", networkId)
        .maybeSingle();
      if (error) throw error;
      return data as Network | null;
    },
    enabled: !!networkId,
  });
}

export function useCreateNetwork() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("networks")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name.trim(),
          description: input.description ?? null,
          layout: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as Network;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["networks", n.project_id] });
    },
  });
}

export function useUpdateNetworkLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      networkId,
      layout,
    }: {
      networkId: string;
      layout: NetworkLayout;
    }) => {
      const { data, error } = await supabase
        .from("networks")
        .update({ layout })
        .eq("id", networkId)
        .select()
        .single();
      if (error) throw error;
      return data as Network;
    },
    onSuccess: (n) => {
      qc.setQueryData(["network", n.id], n);
      qc.invalidateQueries({ queryKey: ["networks", n.project_id] });
    },
  });
}

export function useDeleteNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (network: Pick<Network, "id" | "project_id">) => {
      const { error } = await supabase.from("networks").delete().eq("id", network.id);
      if (error) throw error;
      return network;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["networks", n.project_id] });
    },
  });
}

// =====================================================
// relation_types
// =====================================================

export function useRelationTypes(projectId: string | undefined) {
  return useQuery({
    queryKey: ["relation-types", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("relation_types")
        .select("*")
        .eq("project_id", projectId)
        .order("is_seed", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RelationType[];
    },
    enabled: !!projectId,
  });
}

export function useSeedRelationTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.rpc("seed_relation_types", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return projectId;
    },
    onSuccess: (projectId) => {
      qc.invalidateQueries({ queryKey: ["relation-types", projectId] });
    },
  });
}

export function useCreateRelationType() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
      description?: string;
      color?: string;
      is_symmetric?: boolean;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("relation_types")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          name: input.name.trim(),
          description: input.description ?? null,
          color: input.color ?? "#64748B",
          is_symmetric: input.is_symmetric ?? false,
          is_seed: false,
        })
        .select()
        .single();
      if (error) throw error;
      return data as RelationType;
    },
    onSuccess: (rt) => {
      qc.invalidateQueries({ queryKey: ["relation-types", rt.project_id] });
    },
  });
}

// =====================================================
// links
// =====================================================

export function useLinks(networkId: string | undefined) {
  return useQuery({
    queryKey: ["links", networkId],
    queryFn: async () => {
      if (!networkId) return [];
      const { data, error } = await supabase
        .from("links")
        .select("*")
        .eq("network_id", networkId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Link[];
    },
    enabled: !!networkId,
  });
}

export function useCreateLink() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      networkId: string;
      sourceType: LinkEntityType;
      sourceId: string;
      targetType: LinkEntityType;
      targetId: string;
      relationTypeId?: string | null;
      comment?: string;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("links")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          network_id: input.networkId,
          source_type: input.sourceType,
          source_id: input.sourceId,
          target_type: input.targetType,
          target_id: input.targetId,
          relation_type_id: input.relationTypeId ?? null,
          comment: input.comment ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["links", link.network_id] });
    },
  });
}

export function useUpdateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      relation_type_id?: string | null;
      comment?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("links")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["links", link.network_id] });
    },
  });
}

export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: Pick<Link, "id" | "network_id">) => {
      const { error } = await supabase.from("links").delete().eq("id", link.id);
      if (error) throw error;
      return link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["links", link.network_id] });
    },
  });
}
