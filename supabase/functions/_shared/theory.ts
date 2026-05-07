// Helper to fetch the active theoretical framework for a project so
// every AI edge function can append its `prompt_addendum` consistently.
//
// The function is intentionally cheap: it issues a single PostgREST
// roundtrip and tolerates missing rows (returning null). Callers must
// pass a service-role client because the framework can be a global
// row (project_id null) which the user's JWT can already see, but the
// pattern is uniform across edge functions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface ActiveFramework {
  id: string;
  slug: string;
  name: string;
  prompt_addendum: string;
  citation: string | null;
}

export async function getActiveFramework(
  client: SupabaseClient,
  projectId: string
): Promise<ActiveFramework | null> {
  // Two-step lookup so we don't pay for a join when no framework is set.
  const { data: project, error: pErr } = await client
    .from("projects")
    .select("theory_framework_id")
    .eq("id", projectId)
    .maybeSingle();
  if (pErr || !project?.theory_framework_id) return null;

  const { data: fw, error: fErr } = await client
    .from("theory_frameworks")
    .select("id, slug, name, prompt_addendum, citation")
    .eq("id", project.theory_framework_id)
    .maybeSingle();
  if (fErr || !fw) return null;

  return fw as ActiveFramework;
}
