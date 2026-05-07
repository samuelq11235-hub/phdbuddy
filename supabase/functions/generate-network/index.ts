// Edge Function: generate-network
// Creates a new network from scratch using the project's most-used
// codes and asks Claude to fill it with interpretive relations between
// them. Atlas.ti users will recognise this as the "Auto-Network from
// Concepts" workflow — except Claude does the heavy lifting.
//
// Body: { projectId: string, networkName?: string, topN?: number }
// Returns: { ok, networkId, nodesAdded, linksCreated }

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool } from "../_shared/claude.ts";
import {
  RELATIONS_SYSTEM_PROMPT,
  frameworkAddendum,
  relationsPrompt,
} from "../_shared/prompts.ts";
import { getActiveFramework } from "../_shared/theory.ts";

interface RequestBody {
  projectId: string;
  networkName?: string;
  topN?: number;
}

interface RelationsToolResponse {
  relations: {
    source_code_id: string;
    target_code_id: string;
    relation_type_name: string;
    rationale: string;
  }[];
}

const DEFAULT_TOP_N = 15;
const MAX_TOP_N = 25;
const MAX_QUOTES_PER_CODE = 3;

// Compute a tidy radial layout for the initial code positions. We
// place codes on concentric circles ordered by usage_count so the
// "central" ones land near the middle — easier to read at first glance
// than the staircase fallback.
function radialLayout(
  codeIds: string[]
): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const cx = 600;
  const cy = 360;
  const ringSize = 8;
  for (let i = 0; i < codeIds.length; i++) {
    const ring = Math.floor(i / ringSize);
    const indexOnRing = i % ringSize;
    const radius = 140 + ring * 200;
    const itemsOnThisRing = Math.min(ringSize, codeIds.length - ring * ringSize);
    const angle = (indexOnRing / itemsOnThisRing) * Math.PI * 2 + ring * 0.4;
    layout[`code:${codeIds[i]}`] = {
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
    };
  }
  return layout;
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

  const supabase = getServiceClient();
  const topN = Math.max(3, Math.min(MAX_TOP_N, body.topN ?? DEFAULT_TOP_N));

  // Pull the project + the top-N codes by usage_count + the project's
  // relation types. If relation types haven't been seeded yet, do it
  // here so the user doesn't get a confusing 400.
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name, research_question, methodology")
    .eq("id", body.projectId)
    .single();
  if (pErr || !project) return errorResponse("Project not found", 404);

  const { data: codes, error: cErr } = await supabase
    .from("codes")
    .select("id, name, description, color, usage_count")
    .eq("project_id", body.projectId)
    .order("usage_count", { ascending: false })
    .limit(topN);
  if (cErr) return errorResponse(cErr.message, 500);
  if (!codes || codes.length < 2) {
    return errorResponse(
      "Necesitas al menos 2 códigos en el proyecto para generar una red.",
      400
    );
  }

  // Make sure relation types exist; auto-seed if not.
  let { data: relationTypes } = await supabase
    .from("relation_types")
    .select("id, name, description, is_symmetric, color")
    .eq("project_id", body.projectId);
  if (!relationTypes || relationTypes.length === 0) {
    const { error: seedErr } = await supabase.rpc("seed_relation_types", {
      p_project_id: body.projectId,
    });
    if (seedErr) {
      return errorResponse(`Could not seed relation types: ${seedErr.message}`, 500);
    }
    const reread = await supabase
      .from("relation_types")
      .select("id, name, description, is_symmetric, color")
      .eq("project_id", body.projectId);
    relationTypes = reread.data ?? [];
  }
  if (relationTypes.length === 0) {
    return errorResponse("No relation types available", 500);
  }

  // Sample quotes per code so Claude has anchoring context.
  const samplesByCode = new Map<string, string[]>();
  await Promise.all(
    codes.map(async (c: { id: string }) => {
      const { data: rows } = await supabase
        .from("quotation_codes")
        .select("quotation:quotations(content)")
        .eq("code_id", c.id)
        .limit(MAX_QUOTES_PER_CODE);
      const quotes = (rows ?? [])
        .map((r) => {
          const q = (r as { quotation: { content?: string } | { content?: string }[] | null }).quotation;
          if (!q) return null;
          if (Array.isArray(q)) return q[0]?.content ?? null;
          return q.content ?? null;
        })
        .filter((s): s is string => !!s && s.length > 0);
      samplesByCode.set(c.id, quotes);
    })
  );

  const codeIdSet = new Set((codes as { id: string }[]).map((c) => c.id));
  const allowedTypeNames = new Map(
    (relationTypes as { name: string; id: string }[]).map((rt) => [
      rt.name.toLowerCase(),
      rt.id,
    ])
  );

  // Create the network shell first so we have a stable ID to attach
  // the suggested links to.
  const networkName = body.networkName ?? `Auto-Red · ${new Date().toLocaleDateString()}`;
  const initialLayout = radialLayout((codes as { id: string }[]).map((c) => c.id));
  const { data: network, error: nErr } = await supabase
    .from("networks")
    .insert({
      user_id: userId,
      project_id: body.projectId,
      name: networkName,
      description: `Generada automáticamente sobre los ${codes.length} códigos más usados.`,
      layout: initialLayout,
    })
    .select()
    .single();
  if (nErr || !network) return errorResponse(nErr?.message ?? "Could not create network", 500);

  // Resolve theoretical framework so the system prompt speaks the right
  // analytical dialect (Grounded Theory vs CDA vs IPA, etc).
  const framework = await getActiveFramework(supabase, body.projectId);

  // Now ask Claude.
  let toolResult;
  try {
    toolResult = await callClaudeTool<RelationsToolResponse>(
      [
        {
          role: "user",
          content: relationsPrompt({
            researchQuestion: project.research_question ?? null,
            relationTypes: relationTypes as {
              name: string;
              description: string | null;
              is_symmetric: boolean;
            }[],
            codes: (codes as { id: string; name: string; description: string | null }[]).map(
              (c) => ({
                id: c.id,
                name: c.name,
                description: c.description,
                sample_quotes: samplesByCode.get(c.id) ?? [],
              })
            ),
          }),
        },
      ],
      {
        system: RELATIONS_SYSTEM_PROMPT + frameworkAddendum(framework?.prompt_addendum),
        toolName: "report_code_relations",
        toolDescription:
          "Devuelve un conjunto de relaciones interpretativas entre los códigos del proyecto.",
        inputSchema: {
          type: "object",
          required: ["relations"],
          properties: {
            relations: {
              type: "array",
              maxItems: 25,
              items: {
                type: "object",
                required: [
                  "source_code_id",
                  "target_code_id",
                  "relation_type_name",
                  "rationale",
                ],
                properties: {
                  source_code_id: { type: "string" },
                  target_code_id: { type: "string" },
                  relation_type_name: { type: "string" },
                  rationale: { type: "string" },
                },
              },
            },
          },
        },
        maxTokens: 2200,
        temperature: 0.3,
        cachePrompt: true,
      }
    );
  } catch (err) {
    // Even on Claude failure we leave the empty network in place — the
    // user can manually add relations afterwards.
    return jsonResponse({
      ok: true,
      networkId: network.id,
      nodesAdded: codes.length,
      linksCreated: 0,
      claudeError: err instanceof Error ? err.message : String(err),
    });
  }

  // Validate Claude's output: each relation must reference real codes
  // and an allowed relation type. Drop self-loops and duplicates.
  const seen = new Set<string>();
  const linksToInsert: {
    user_id: string;
    project_id: string;
    network_id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relation_type_id: string | null;
    comment: string | null;
  }[] = [];

  for (const rel of toolResult.data.relations) {
    if (!codeIdSet.has(rel.source_code_id) || !codeIdSet.has(rel.target_code_id)) continue;
    if (rel.source_code_id === rel.target_code_id) continue;
    const rtName = rel.relation_type_name.toLowerCase();
    const rtId = allowedTypeNames.get(rtName) ?? null;
    const dedupeKey = `${rel.source_code_id}:${rel.target_code_id}:${rtId ?? "_"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    linksToInsert.push({
      user_id: userId,
      project_id: body.projectId,
      network_id: network.id,
      source_type: "code",
      source_id: rel.source_code_id,
      target_type: "code",
      target_id: rel.target_code_id,
      relation_type_id: rtId,
      comment: rel.rationale,
    });
  }

  let inserted = 0;
  if (linksToInsert.length > 0) {
    const { error: linkErr } = await supabase.from("links").insert(linksToInsert);
    if (linkErr) {
      console.warn("[generate-network] link insert failed:", linkErr.message);
    } else {
      inserted = linksToInsert.length;
    }
  }

  return jsonResponse({
    ok: true,
    networkId: network.id,
    nodesAdded: codes.length,
    linksCreated: inserted,
  });
});
