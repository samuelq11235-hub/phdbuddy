// Edge Function: suggest-relations
// Given a network and a set of codes, ask Claude to propose interpretive
// relationships ("is-cause-of", "is-part-of", ...) between them, drawing
// from the project's relation_types vocabulary. The output is stored as
// an `ai_suggestion` row of kind='relation' so the user can review/apply
// it like any other AI batch.
//
// Body: { networkId: string, codeIds: string[] }
//
// Returns: { ok, suggestionId, model, relations: [...] }

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool, CLAUDE_MODEL } from "../_shared/claude.ts";
import { RELATIONS_SYSTEM_PROMPT, relationsPrompt } from "../_shared/prompts.ts";

interface RequestBody {
  networkId?: string;
  codeIds?: string[];
}

interface RelationsToolResponse {
  relations: {
    source_code_id: string;
    target_code_id: string;
    relation_type_name: string;
    rationale: string;
  }[];
}

// Cap how much we send to Claude. Past 30 codes the prompt becomes
// noisy and the model loses precision; users can re-run with a subset.
const MAX_CODES = 30;
const MAX_QUOTES_PER_CODE = 3;

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

  if (!body.networkId) return errorResponse("Missing networkId", 400);
  if (!body.codeIds || body.codeIds.length < 2) {
    return errorResponse("Provide at least 2 codeIds", 400);
  }

  const supabase = getServiceClient();
  const codeIds = body.codeIds.slice(0, MAX_CODES);

  const { data: network, error: networkErr } = await supabase
    .from("networks")
    .select("id, project_id, user_id")
    .eq("id", body.networkId)
    .eq("user_id", userId)
    .maybeSingle();
  if (networkErr) return errorResponse(networkErr.message, 500);
  if (!network) return errorResponse("Network not found", 404);

  const projectId = network.project_id;

  const [{ data: project }, { data: codes }, { data: relationTypes }] = await Promise.all([
    supabase
      .from("projects")
      .select("research_question, methodology")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("codes")
      .select("id, name, description")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .in("id", codeIds),
    supabase
      .from("relation_types")
      .select("id, name, description, is_symmetric")
      .eq("project_id", projectId)
      .eq("user_id", userId),
  ]);

  if (!codes || codes.length < 2) {
    return errorResponse("Could not load enough codes", 400);
  }
  if (!relationTypes || relationTypes.length === 0) {
    return errorResponse(
      "Project has no relation types. Seed them first with seed_relation_types().",
      400
    );
  }

  // Pull a handful of representative quotations per code. We're only
  // priming the prompt — quality matters more than recency.
  const samplesByCode = new Map<string, string[]>();
  await Promise.all(
    codes.map(async (c: { id: string }) => {
      const { data: rows } = await supabase
        .from("quotation_codes")
        .select("quotation:quotations(content)")
        .eq("code_id", c.id)
        .eq("user_id", userId)
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

  const allowedTypeNames = new Set(
    (relationTypes as { name: string }[]).map((rt) => rt.name.toLowerCase())
  );
  const allowedCodeIds = new Set((codes as { id: string }[]).map((c) => c.id));

  let toolResult;
  try {
    toolResult = await callClaudeTool<RelationsToolResponse>(
      [
        {
          role: "user",
          content: relationsPrompt({
            researchQuestion: (project as { research_question?: string | null } | null)
              ?.research_question ?? null,
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
        system: RELATIONS_SYSTEM_PROMPT,
        toolName: "report_code_relations",
        toolDescription:
          "Devuelve un conjunto de relaciones interpretativas entre los códigos del proyecto, usando solo los nombres de relation_type permitidos y los ids de código proporcionados.",
        inputSchema: {
          type: "object",
          required: ["relations"],
          properties: {
            relations: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                required: [
                  "source_code_id",
                  "target_code_id",
                  "relation_type_name",
                  "rationale",
                ],
                properties: {
                  source_code_id: { type: "string", description: "uuid del código origen" },
                  target_code_id: { type: "string", description: "uuid del código destino" },
                  relation_type_name: { type: "string", description: "nombre del relation_type" },
                  rationale: { type: "string", description: "Una oración justificando la relación." },
                },
              },
            },
          },
        },
        maxTokens: 2048,
        temperature: 0.2,
      }
    );
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "claude failed", 500);
  }

  // Sanitize: drop relations that reference unknown codes/types or self-loops.
  const seen = new Set<string>();
  const cleaned = (toolResult.data.relations ?? []).filter((rel) => {
    if (!rel || typeof rel !== "object") return false;
    if (!allowedCodeIds.has(rel.source_code_id)) return false;
    if (!allowedCodeIds.has(rel.target_code_id)) return false;
    if (rel.source_code_id === rel.target_code_id) return false;
    const typeName = (rel.relation_type_name ?? "").toLowerCase();
    if (!allowedTypeNames.has(typeName)) return false;
    const key = `${rel.source_code_id}::${rel.target_code_id}::${typeName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { data: suggestion, error: suggErr } = await supabase
    .from("ai_suggestions")
    .insert({
      user_id: userId,
      project_id: projectId,
      kind: "relation",
      payload: {
        network_id: body.networkId,
        relations: cleaned,
      },
      status: "pending",
      model: toolResult.model ?? CLAUDE_MODEL,
    })
    .select()
    .single();

  if (suggErr) return errorResponse(suggErr.message, 500);

  return jsonResponse({
    ok: true,
    suggestionId: (suggestion as { id: string }).id,
    model: toolResult.model ?? CLAUDE_MODEL,
    relations: cleaned,
  });
});
