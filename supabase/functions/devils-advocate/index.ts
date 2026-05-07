// Edge Function: devils-advocate
//
// Stress-tests an interpretation by surfacing contrary evidence from the
// corpus. The user supplies a "claim" — usually the description of a
// code, the body of a memo, or a phrase like "Los participantes son
// optimistas sobre la IA" — and we:
//
//   1. Generate a *negation/counter* query via Claude Haiku so the
//      embedding search retrieves quotations that semantically OPPOSE
//      the claim, not just rephrase it.
//   2. Run two semantic searches — claim AND counter — but issue both
//      embeddings in a SINGLE Voyage call to halve the round-trip cost.
//   3. Ask Sonnet to score each candidate quote 0..1 on how strongly
//      it contradicts the claim, and to write a short synthesis.
//
// All three steps live behind an `ai_cache` row keyed by (claim, source,
// k). Repeat invocations are free until 24h pass or the user passes
// `refresh: true`. This typically reduces token cost on the second hit
// to *zero*, since we never call Claude again.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaude, callClaudeTool } from "../_shared/claude.ts";
import { embedTexts } from "../_shared/voyage.ts";
import { getActiveFramework } from "../_shared/theory.ts";
import { frameworkAddendum } from "../_shared/prompts.ts";
import { getOrSetAiCache, hashInput } from "../_shared/cache.ts";

interface RequestBody {
  projectId: string;
  claim: string;
  source?: string;
  k?: number;
  // Forces a recomputation even if a fresh cache row exists. Wired to
  // the "Reanalizar" button in the UI.
  refresh?: boolean;
}

interface QMatch {
  id: string;
  document_id: string;
  content: string;
  similarity: number;
}

interface WeakSpot {
  quotationId: string;
  documentTitle: string;
  text: string;
  contradictionScore: number;
  rationale: string;
}

const COUNTER_QUERY_SYSTEM = `Reformulas afirmaciones de investigación cualitativa para encontrar evidencia contradictoria. Devuelve únicamente la frase reformulada en el idioma original. No comentes.`;

const SCORE_SYSTEM = `Crítica metodológica senior. Evalúas con honestidad si una cita refuta o complica una afirmación. No inventes citas; trabaja sólo con el material proporcionado.`;

const SCORE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    weak_spots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quotation_id: { type: "string" },
          contradiction_score: {
            type: "number",
            description: "0 = irrelevante, 1 = contradicción frontal",
          },
          rationale: { type: "string", description: "1-2 oraciones." },
        },
        required: ["quotation_id", "contradiction_score", "rationale"],
      },
    },
    synthesis: {
      type: "string",
      description: "2-4 oraciones sobre las grietas más serias.",
    },
  },
  required: ["weak_spots", "synthesis"],
} as const;

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
  if (!body.claim || body.claim.trim().length < 8) {
    return errorResponse("La afirmación debe tener al menos 8 caracteres.", 400);
  }

  const supabase = getServiceClient();

  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", body.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return errorResponse("Forbidden", 403);

  const k = Math.min(Math.max(body.k ?? 8, 4), 16);
  const cacheInput = {
    claim: body.claim.trim().toLowerCase(),
    source: body.source ?? null,
    k,
  };

  if (body.refresh) {
    const stale = await hashInput(cacheInput);
    await supabase
      .from("ai_cache")
      .delete()
      .eq("project_id", body.projectId)
      .eq("kind", "devils_advocate")
      .eq("input_hash", stale);
  }

  try {
    const result = await getOrSetAiCache<{
      counterClaim: string;
      weakSpots: WeakSpot[];
      synthesis: string;
    }>(supabase, {
      projectId: body.projectId,
      kind: "devils_advocate",
      input: cacheInput,
      ttlSeconds: 60 * 60 * 24,
      compute: () =>
        runPipeline(supabase, body.projectId, body.claim, body.source, k),
    });

    return jsonResponse({
      ok: true,
      cached: result.cached,
      ageMs: result.ageMs,
      ...result.value,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Devil's advocate failed",
      500
    );
  }
});

// ============================================================
// Compute pipeline (Haiku → Voyage batch → vector search → Sonnet).
// ============================================================
async function runPipeline(
  supabase: ReturnType<typeof getServiceClient>,
  projectId: string,
  claim: string,
  source: string | undefined,
  k: number
): Promise<{ counterClaim: string; weakSpots: WeakSpot[]; synthesis: string }> {
  // Step 1 — counter rewrite. Haiku, ~80 output tokens.
  const r = await callClaude(
    [
      {
        role: "user",
        content: `Afirmación: """${claim.trim()}"""

Reformula esta afirmación para que su negación o tensión opuesta sea explícita.
Mantén el tema y la jerga. Devuelve SOLO la frase reformulada.`,
      },
    ],
    {
      system: COUNTER_QUERY_SYSTEM,
      model: "claude-haiku-4-5",
      maxTokens: 100,
      temperature: 0.4,
      cachePrompt: true,
    }
  );
  let counterClaim = (r.text ?? "").trim().replace(/^["“]|["”]$/g, "");
  if (!counterClaim) counterClaim = `Lo contrario de: ${claim.trim()}`;

  // Step 2 — batch BOTH embeddings in a single Voyage call. Halves
  // the round-trip count and avoids burning two slots in the rate
  // limit window for what is logically one query pair.
  const { embeddings } = await embedTexts([claim, counterClaim], {
    inputType: "query",
  });
  const [claimVec, counterVec] = embeddings;

  const [claimRes, counterRes] = await Promise.all([
    supabase.rpc("match_project_quotations", {
      query_embedding: claimVec,
      match_project_id: projectId,
      match_threshold: 0.3,
      match_count: k,
    }),
    supabase.rpc("match_project_quotations", {
      query_embedding: counterVec,
      match_project_id: projectId,
      match_threshold: 0.3,
      match_count: k * 2,
    }),
  ]);
  const claimSet = new Set((claimRes.data ?? []).map((q: QMatch) => q.id));
  const candidates: QMatch[] = ((counterRes.data ?? []) as QMatch[])
    .map((q) => ({
      ...q,
      similarity: claimSet.has(q.id) ? q.similarity * 0.85 : q.similarity,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  if (candidates.length === 0) {
    return {
      counterClaim,
      weakSpots: [],
      synthesis:
        "El corpus no contiene material que tense esta afirmación de forma directa. Esto puede indicar saturación... o cobertura insuficiente.",
    };
  }

  const docIds = [...new Set(candidates.map((c) => c.document_id))];
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", docIds);
  const docTitles = new Map<string, string>();
  for (const d of docs ?? []) docTitles.set(d.id as string, d.title as string);

  const framework = await getActiveFramework(supabase, projectId);

  // Tighter slice (480 chars vs 600 before): scoring quality is
  // unchanged in our evals but trims ~20% of the input bill.
  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `[${i + 1}] id=${c.id}\nDoc: ${
          docTitles.get(c.document_id) ?? "?"
        }\nTexto: """${c.content.replace(/"/g, "'").slice(0, 480)}"""`
    )
    .join("\n\n");

  const scored = await callClaudeTool<{
    weak_spots: {
      quotation_id: string;
      contradiction_score: number;
      rationale: string;
    }[];
    synthesis: string;
  }>(
    [
      {
        role: "user",
        content: `Afirmación a someter a crítica:\n"""${claim.trim()}"""${
          source ? `\nFuente: ${source}` : ""
        }\n\nCandidatos a contraevidencia:\n\n${candidatesBlock}\n\nTarea: para cada cita, asigna \`contradiction_score\` 0..1 (1 = contradice frontalmente). Rationale 1-2 oraciones. Termina con \`synthesis\`.`,
      },
    ],
    {
      system: SCORE_SYSTEM + frameworkAddendum(framework?.prompt_addendum),
      toolName: "submit_devil_critique",
      toolDescription: "Evalúa cada cita y produce una síntesis crítica.",
      inputSchema: SCORE_TOOL_SCHEMA,
      // Down from 1500 — empirically the response is ~700 tokens for
      // k=8 candidates; 1100 leaves headroom without bloating max.
      maxTokens: 1100,
      temperature: 0.25,
      cachePrompt: true,
    }
  );

  const candidatesById = new Map(candidates.map((c) => [c.id, c]));
  const weakSpots: WeakSpot[] = (scored.weak_spots ?? [])
    .map((s) => {
      const cand = candidatesById.get(s.quotation_id);
      if (!cand) return null;
      return {
        quotationId: s.quotation_id,
        documentTitle: docTitles.get(cand.document_id) ?? "(sin título)",
        text: cand.content,
        contradictionScore: Math.max(0, Math.min(1, s.contradiction_score)),
        rationale: s.rationale,
      } satisfies WeakSpot;
    })
    .filter((x): x is WeakSpot => x !== null)
    .sort((a, b) => b.contradictionScore - a.contradictionScore);

  return {
    counterClaim,
    weakSpots,
    synthesis: scored.synthesis,
  };
}
