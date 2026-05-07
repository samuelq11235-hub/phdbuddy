import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { TheoryFramework } from "@/types/database";

// Returns the canonical seeded frameworks plus any custom frameworks
// scoped to the given project. Sorting puts globals first so the
// dropdown opens with the well-known options at the top.
export function useTheoryFrameworks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["theory_frameworks", projectId ?? "global"],
    queryFn: async () => {
      let q = supabase
        .from("theory_frameworks")
        .select("*")
        .order("project_id", { ascending: true, nullsFirst: true })
        .order("name", { ascending: true });
      if (projectId) {
        q = q.or(`project_id.is.null,project_id.eq.${projectId}`);
      } else {
        q = q.is("project_id", null);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TheoryFramework[];
    },
  });
}

export function useSetProjectFramework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; frameworkId: string | null }) => {
      const { error } = await supabase
        .from("projects")
        .update({ theory_framework_id: input.frameworkId })
        .eq("id", input.projectId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["project", variables.projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
