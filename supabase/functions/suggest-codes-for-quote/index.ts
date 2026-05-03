// Edge Function: suggest-codes-for-quote
// Given a single quotation, propose the best codes to assign:
// - Pulls the project codebook + the top semantically-similar codes via embeddings
// - Asks Claude to pick the best fits and (optionally) suggest at most 1-2 new codes

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { embedQuery } from "../_shared/voyage.ts";
import { callClaudeTool, CLAUDE_MODEL } from "../_shared/claude.ts";
import {
  SUGGEST_CODES_SYSTEM_PROMPT,
  suggestCodesForQuotePrompt,
} from "../_shared/prompts.ts";

const SUGGEST_TOOL_SCHEMA = {
  type: "object",
  required: ["existing_codes", "new_codes"],
  properties: {
    existing_codes: {
      type: "array",
      description: "Códigos del codebook existente que aplican a esta cita.",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Nombre exacto del código existente." },
          confidence: { type: "number", description: "Confianza entre 0 y 1." },
          rationale: { type: "string", description: "Una oración explicando por qué encaja." },
        },
      },
    },
    new_codes: {
      type: "array",
      description:
        "Como máximo 1-2 códigos nuevos solo si ningún código existente encaja bien.",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Etiqueta corta (2-5 palabras)." },
          description: { type: "string", description: "Una sola oración corta." },
          rationale: { type: "string", description: "Por qué necesitas un código nuevo." },
        },
      },
    },
  },
};

interface RequestBody {
  quotationId?: string;
  // Inline mode: caller passes raw text without persisting first.
  projectId?: string;
  documentId?: string;
  text?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface AIResponse {
  existing_codes?: { name: string; confidence?: number; rationale?: string }[];
  new_codes?: { name: string; description?: string; rationale?: string }[];
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

  const supabase = getServiceClient();

  let quote: string;
  let projectId: string;
  let context = "";

  if (body.quotationId) {
    const { data: q, error } = await supabase
      .from("quotations")
      .select("content, project_id, document_id, start_offset, end_offset")
      .eq("id", body.quotationId)
      .eq("user_id", userId)
      .single();
    if (error || !q) return errorResponse("Quotation not found", 404);
    quote = q.content;
    projectId = q.project_id;
    if (q.document_id) {
      const { data: doc } = await supabase
        .from("documents")
        .select("full_text")
        .eq("id", q.document_id)
        .single();
      if (doc?.full_text) {
        const start = Math.max(0, q.start_offset - 300);
        const end = Math.min(doc.full_text.length, q.end_offset + 300);
        context = doc.full_text.slice(start, end);
      }
    }
  } else {
    if (!body.projectId || !body.text) {
      return errorResponse("Provide quotationId OR projectId+text", 400);
    }
    quote = body.text;
    projectId = body.projectId;
    context = `${body.contextBefore ?? ""} ${body.text} ${body.contextAfter ?? ""}`;
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, research_question")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (!project) return errorResponse("Project not found", 404);

  // Full codebook
  const { data: codes } = await supabase
    .from("codes")
    .select("id, name, description")
    .eq("project_id", projectId);
  const codebook = codes ?? [];

  // Top-K semantically similar codes (via quotation embeddings of past codings):
  // we cheat by embedding the candidate quote and matching against the project's
  // existing quotation embeddings, then collecting the codes attached to those
  // top quotations.
  let semanticCandidates: { name: string; description: string | null }[] = [];
  try {
    const queryVec = await embedQuery(quote);
    const { data: matches } = await supabase.rpc("match_project_quotations", {
      query_embedding: queryVec,
      match_project_id: projectId,
      match_threshold: 0.3,
      match_count: 6,
    });
    if (matches && matches.length > 0) {
      const ids = matches.map((m: { id: string }) => m.id);
      const { data: relCodings } = await supabase
        .from("quotation_codes")
        .select("code_id, codes(name, description)")
        .in("quotation_id", ids);
      const seen = new Set<string>();
      for (const row of relCodings ?? []) {
        const c = (row as { codes: { name: string; description: string | null } | null })
          .codes;
        if (!c || seen.has(c.name)) continue;
        seen.add(c.name);
        semanticCandidates.push({ name: c.name, description: c.description });
      }
      semanticCandidates = semanticCandidates.slice(0, 8);
    }
  } catch (err) {
    console.warn("[suggest-codes] semantic candidate lookup failed:", err);
  }

  let aiResp: AIResponse;
  let model: string;
  try {
    const result = await callClaudeTool<AIResponse>(
      [
        {
          role: "user",
          content: suggestCodesForQuotePrompt({
            quote,
            quoteContext: context.slice(0, 1500),
            codebook,
            semanticCandidates,
            researchQuestion: project.research_question,
          }),
        },
      ],
      {
        system: SUGGEST_CODES_SYSTEM_PROMPT,
        toolName: "suggest_codes",
        toolDescription:
          "Devuelve los códigos del codebook que aplican a esta cita y, si hace falta, 1-2 códigos nuevos.",
        inputSchema: SUGGEST_TOOL_SCHEMA,
        maxTokens: 2048,
        temperature: 0.2,
      }
    );
    aiResp = result.data;
    model = result.model;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Claude failed", 500);
  }

  // Match each existing_codes name to a real code id.
  const codeByName = new Map(codes?.map((c) => [c.name.toLowerCase(), c]) ?? []);
  const matched: { id: string; name: string; description: string | null; confidence: number; rationale?: string }[] = [];
  for (const ec of aiResp.existing_codes ?? []) {
    const c = codeByName.get(ec.name.toLowerCase());
    if (c) {
      matched.push({
        id: c.id,
        name: c.name,
        description: c.description,
        confidence: ec.confidence ?? 0.7,
        rationale: ec.rationale,
      });
    }
  }

  return jsonResponse({
    ok: true,
    model: model ?? CLAUDE_MODEL,
    existing: matched,
    new: (aiResp.new_codes ?? []).map((n) => ({
      name: n.name,
      description: n.description ?? null,
      rationale: n.rationale,
    })),
  });
});
