// Edge Function: code-network
//
// Returns the co-occurrence network of codes for a project, in the
// canonical { nodes, edges } shape so it can be consumed by D3, React
// Flow, vis-network, Cytoscape… or any external client via the supabase
// /functions/v1 endpoint.
//
// Method: POST
// Body:
//   {
//     projectId: string,
//     codeGroupId?: string,    // restrict to codes belonging to this group
//     minWeight?: number,      // drop edges with weight < minWeight (default 1)
//     limitTopEdges?: number   // optional cap on # of edges (top-N by weight)
//   }
//
// Response shape (matches the public spec verbatim):
//   {
//     ok: true,
//     projectId: string,
//     generatedAt: ISO-8601,
//     stats: { nodeCount, edgeCount, totalQuotations },
//     nodes: [{ id, label, size, color, parent_id }],
//     edges: [{ source, target, weight }]
//   }
//
// Caching:
//   - Browser/CDN: max-age=15, stale-while-revalidate=60. Co-occurrence
//     is derived from `quotation_codes`, which only changes when the
//     user codes/uncodes — we want fresh-enough data without hammering
//     Postgres. Clients that need invalidation NOW can bust by adding
//     a busted=<ts> field to the body.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface RequestBody {
  projectId?: string;
  codeGroupId?: string | null;
  minWeight?: number;
  limitTopEdges?: number;
}

interface CodeRow {
  id: string;
  name: string;
  color: string;
  usage_count: number;
  parent_id: string | null;
}

interface CooccurrenceRow {
  code_a: string;
  code_b: string;
  occurrences: number;
}

interface NetworkNode {
  id: string;
  label: string;
  size: number;
  color: string;
  parent_id: string | null;
}

interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let userId: string;
  try {
    ({ userId } = await getUserFromRequest(req));
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unauthorized", 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.projectId) return errorResponse("Missing projectId", 400);

  const minWeight = Math.max(1, Math.floor(body.minWeight ?? 1));
  const limitTopEdges = Math.max(0, Math.floor(body.limitTopEdges ?? 0));

  const supabase = getServiceClient();

  // 1. Verify the user owns the project. RLS on the underlying tables
  //    would already block them but the explicit check produces a nicer
  //    error and avoids returning empty payloads on misuse.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, user_id, quotation_count")
    .eq("id", body.projectId)
    .maybeSingle();
  if (projErr) return errorResponse(projErr.message, 500);
  if (!project) return errorResponse("Project not found", 404);
  if (project.user_id !== userId) {
    return errorResponse("Not authorized for this project", 403);
  }

  // 2. Optional filter — limit codes to those belonging to a group.
  let allowedCodeIds: Set<string> | null = null;
  if (body.codeGroupId) {
    const { data: members, error: memErr } = await supabase
      .from("code_group_members")
      .select("code_id")
      .eq("code_group_id", body.codeGroupId)
      .eq("user_id", userId);
    if (memErr) return errorResponse(memErr.message, 500);
    allowedCodeIds = new Set((members ?? []).map((m: { code_id: string }) => m.code_id));
    if (allowedCodeIds.size === 0) {
      // Group has no members yet — return an empty network rather than
      // 200ing a half-built graph that hides the real cause.
      return jsonResponse(
        {
          ok: true,
          projectId: body.projectId,
          generatedAt: new Date().toISOString(),
          stats: { nodeCount: 0, edgeCount: 0, totalQuotations: 0 },
          nodes: [],
          edges: [],
          notice: "El grupo seleccionado no tiene códigos asignados.",
        },
        {
          headers: {
            "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
          },
        }
      );
    }
  }

  // 3. Codes & cooccurrence — issued in parallel.
  const [codesRes, coRes] = await Promise.all([
    supabase
      .from("codes")
      .select("id, name, color, usage_count, parent_id")
      .eq("project_id", body.projectId)
      .eq("user_id", userId),
    supabase.rpc("code_cooccurrence", { match_project_id: body.projectId }),
  ]);
  if (codesRes.error) return errorResponse(codesRes.error.message, 500);
  if (coRes.error) return errorResponse(coRes.error.message, 500);

  const allCodes = (codesRes.data ?? []) as CodeRow[];
  const cooccurrence = (coRes.data ?? []) as CooccurrenceRow[];

  // 4. Filter codes by group (if any) and build a quick lookup.
  const visibleCodes = allowedCodeIds
    ? allCodes.filter((c) => allowedCodeIds!.has(c.id))
    : allCodes;
  const visibleSet = new Set(visibleCodes.map((c) => c.id));

  // 5. Edges — apply minWeight + group filter + (optional) top-N cap.
  let filteredEdges: NetworkEdge[] = cooccurrence
    .filter((row) => {
      const w = Number(row.occurrences);
      if (!Number.isFinite(w) || w < minWeight) return false;
      if (allowedCodeIds && (!visibleSet.has(row.code_a) || !visibleSet.has(row.code_b))) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      source: row.code_a,
      target: row.code_b,
      weight: Number(row.occurrences),
    }));

  if (limitTopEdges > 0 && filteredEdges.length > limitTopEdges) {
    filteredEdges = filteredEdges
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limitTopEdges);
  }

  // 6. Nodes — keep only codes that either co-occur with another code
  //    in the filtered edge set OR have at least one citation. Codes
  //    with usage_count = 0 and no edges are noise on the canvas.
  const idsInEdges = new Set<string>();
  for (const e of filteredEdges) {
    idsInEdges.add(e.source);
    idsInEdges.add(e.target);
  }
  const nodes: NetworkNode[] = visibleCodes
    .filter((c) => idsInEdges.has(c.id) || c.usage_count > 0)
    .map((c) => ({
      id: c.id,
      label: c.name,
      size: c.usage_count,
      color: c.color,
      parent_id: c.parent_id,
    }));

  // 7. Drop edges whose endpoints aren't in the final node set (can
  //    happen if a code was filtered out by group membership).
  const finalNodeIds = new Set(nodes.map((n) => n.id));
  const edges = filteredEdges.filter(
    (e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)
  );

  return jsonResponse(
    {
      ok: true,
      projectId: body.projectId,
      generatedAt: new Date().toISOString(),
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        totalQuotations: project.quotation_count ?? 0,
      },
      nodes,
      edges,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      },
    }
  );
});
