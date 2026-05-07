// Edge Function: devils-advocate
//
// Stress-tests an interpretation by surfacing contrary evidence from the
// corpus. The user supplies a "claim" — usually the description of a
// code, the body of a memo, or a phrase like "Los participantes son
// optimistas sobre la IA" — and we:
//
//   1. Generate a *negation/counter* query via Claude (cheap Haiku call)
//      so the embedding search retrieves quotations that semantically
//      OPPOSE the claim, not just rephrase it.
//   2. Run two semantic searches in parallel: the original claim AND
//      the counter query. We surface the counter results.
//   3. Ask Sonnet (or whatever the project framework prefers) to score
//      each candidate quote 0..1 on how strongly it contradicts the
//      claim, and to write a short "counter-argument" synthesis.
//
// Body: { projectId: string, claim: string, k?: number }
// Returns: { ok, counterClaim, weakSpots: [...], synthesis }
//
// This is the qualitative-research equivalent of a hostile reviewer:
// before you publish a finding, hand it to the devil's advocate.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaude, callClaudeTool } from "../_shared/claude.ts";
import { embedQuery } from "../_shared/voyage.ts";
import { getActiveFramework } from "../_shared/theory.ts";
import { frameworkAddendum } from "../_shared/prompts.ts";

interface RequestBody {
  projectId: string;
  claim: string;
  // Optional source label to give the AI more context — e.g.
  // "Code: optimismo digital" or "Memo: hipótesis 3".
  source?: string;
  k?: number;
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
          rationale: {
            type: "string",
            description: "1-2 oraciones explicando la tensión.",
          },
        },
        required: ["quotation_id", "contradiction_score", "rationale"],
      },
    },
    synthesis: {
      type: "string",
      description:
        "Resumen de cómo el corpus desafía o matiza la afirmación; 2-4 oraciones.",
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

  // Authorisation: must be a project member.
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", body.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return errorResponse("Forbidden", 403);

  const k = Math.min(Math.max(body.k ?? 8, 4), 16);

  // Step 1 — counter query. Haiku is plenty for one-line rephrasing.
  let counterClaim: string;
  try {
    const r = await callClaude(
      [
        {
          role: "user",
          content: `Afirmación: """${body.claim.trim()}"""

Reformula esta afirmación para que su negación o tensión opuesta sea explícita.
Mantén el tema y la jerga. Devuelve SOLO la frase reformulada.`,
        },
      ],
      {
        system: COUNTER_QUERY_SYSTEM,
        model: "claude-haiku-4-5",
        maxTokens: 120,
        temperature: 0.4,
      }
    );
    counterClaim = (r.text ?? "").trim().replace(/^["“]|["”]$/g, "");
    if (!counterClaim) counterClaim = `Lo contrario de: ${body.claim.trim()}`;
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Counter-query failed",
      500
    );
  }

  // Step 2 — parallel embed & semantic search of both queries. We
  // dedupe by quotation id and keep top-k by *counter* similarity.
  let candidates: QMatch[];
  try {
    const [claimVec, counterVec] = await Promise.all([
      embedQuery(body.claim),
      embedQuery(counterClaim),
    ]);
    const [claimRes, counterRes] = await Promise.all([
      supabase.rpc("match_project_quotations", {
        query_embedding: claimVec,
        match_project_id: body.projectId,
        match_threshold: 0.3,
        match_count: k,
      }),
      supabase.rpc("match_project_quotations", {
        query_embedding: counterVec,
        match_project_id: body.projectId,
        match_threshold: 0.3,
        match_count: k * 2,
      }),
    ]);
    const claimSet = new Set((claimRes.data ?? []).map((q: QMatch) => q.id));
    candidates = ((counterRes.data ?? []) as QMatch[])
      // Keep counter-only matches first; any quote that ALSO matches
      // the claim is interesting (it's "ambiguous") so include it too.
      .map((q) => ({
        ...q,
        similarity: claimSet.has(q.id) ? q.similarity * 0.85 : q.similarity,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Semantic search failed",
      500
    );
  }

  if (candidates.length === 0) {
    return jsonResponse({
      ok: true,
      counterClaim,
      weakSpots: [],
      synthesis:
        "El corpus no contiene material que tense esta afirmación de forma directa. Esto puede indicar saturación... o cobertura insuficiente.",
    });
  }

  // Step 3 — resolve titles for nicer UI rendering.
  const docIds = [...new Set(candidates.map((c) => c.document_id))];
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", docIds);
  const docTitles = new Map<string, string>();
  for (const d of docs ?? []) docTitles.set(d.id as string, d.title as string);

  // Step 4 — score with Sonnet using the framework addendum so the
  // critique speaks the project's analytical dialect.
  const framework = await getActiveFramework(supabase, body.projectId);

  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `[${i + 1}] id=${c.id}\nDoc: ${
          docTitles.get(c.document_id) ?? "(sin título)"
        }\nTexto: """${c.content.replace(/"/g, "'").slice(0, 600)}"""`
    )
    .join("\n\n");

  let scored;
  try {
    scored = await callClaudeTool<{
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
          content: `Afirmación a someter a crítica:\n"""${body.claim.trim()}"""${
            body.source ? `\nFuente original: ${body.source}` : ""
          }\n\nCandidatos a contraevidencia (extraídos por similitud semántica):\n\n${candidatesBlock}\n\nTarea: para cada cita, asigna un \`contradiction_score\` 0..1 (1 = contradice frontalmente, 0 = es coherente con la afirmación). Escribe un rationale de 1-2 oraciones. Termina con un \`synthesis\` que enumere las grietas más serias para la afirmación.`,
        },
      ],
      {
        system: SCORE_SYSTEM + frameworkAddendum(framework?.prompt_addendum),
        toolName: "submit_devil_critique",
        toolDescription: "Evalúa cada cita y produce una síntesis crítica.",
        inputSchema: SCORE_TOOL_SCHEMA,
        maxTokens: 1500,
        temperature: 0.25,
      }
    );
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Scoring failed",
      500
    );
  }

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

  return jsonResponse({
    ok: true,
    counterClaim,
    weakSpots,
    synthesis: scored.synthesis,
  });
});
