import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ActivityEvent {
  id: string;
  project_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: "create" | "update" | "delete" | "attach" | "detach" | "role_change";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActivityEventWithActor extends ActivityEvent {
  actor_name: string | null;
  actor_avatar: string | null;
}

export function useActivityLog(projectId: string | undefined, limit = 200) {
  return useQuery({
    queryKey: ["activity-log", projectId, limit],
    queryFn: async (): Promise<ActivityEventWithActor[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as ActivityEvent[];
      const actorIds = Array.from(
        new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))
      );
      const profiles =
        actorIds.length > 0
          ? (
              await supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .in("id", actorIds)
            ).data ?? []
          : [];
      const profById = new Map(
        (profiles as Array<{ id: string; full_name: string | null; avatar_url: string | null }>).map(
          (p) => [p.id, p]
        )
      );
      return rows.map((r) => {
        const p = r.actor_id ? profById.get(r.actor_id) : null;
        return {
          ...r,
          actor_name: p?.full_name ?? null,
          actor_avatar: p?.avatar_url ?? null,
        };
      });
    },
    enabled: !!projectId,
  });
}
