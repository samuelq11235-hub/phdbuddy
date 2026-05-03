// Edge Function: analyze-sentiment
// Compute Claude-derived sentiment for one or more quotations and persist
// the structured output (polarity, label, aspects, emotions) into
// public.quotation_sentiment. Idempotent via upsert on quotation_id.
//
// Two invocation modes:
//   { quotationIds: ["uuid", ...] }   → analyze a fixed batch
//   { projectId: "uuid", limit?: N }  → analyze the next N quotations of the
//                                        project that have no sentiment yet
//
// We process sequentially (1 Claude call per quotation) but cap concurrency
// so we never blow past Anthropic rate limits in a single Deno request.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool, CLAUDE_MODEL } from "../_shared/claude.ts";
import { SENTIMENT_SYSTEM_PROMPT, sentimentPrompt } from "../_shared/prompts.ts";

const SENTIMENT_TOOL_SCHEMA = {
  type: "object",
  required: ["polarity", "label"],
  properties: {
    polarity: {
      type: "number",
      description: "Polaridad afectiva en el rango [-1, 1].",
    },
    label: {
      type: "string",
      enum: ["positive", "negative", "neutral", "mixed"],
      description: "Etiqueta categórica.",
    },
    aspects: {
      type: "array",
      description: "Hasta 3 entidades o temas con polaridad propia.",
      items: {
        type: "object",
        required: ["aspect", "polarity"],
        properties: {
          aspect: { type: "string", description: "Entidad/tema concreto." },
          polarity: { type: "number", description: "Polaridad de ese aspecto." },
        },
      },
    },
    emotions: {
      type: "array",
      description: "Hasta 3 emociones primarias detectadas.",
      items: { type: "string" },
    },
  },
};

interface SentimentToolResponse {
  polarity: number;
  label: "positive" | "negative" | "neutral" | "mixed";
  aspects?: { aspect: string; polarity: number }[];
  emotions?: string[];
}

interface RequestBody {
  quotationIds?: string[];
  projectId?: string;
  limit?: number;
}

interface QuotationRow {
  id: string;
  user_id: string;
  project_id: string;
  document_id: string;
  start_offset: number;
  end_offset: number;
  content: string;
  document?: {
    title: string | null;
    kind: string | null;
    full_text: string | null;
  } | null;
}

// Hard cap so a single invocation can't bankrupt the user. Anything bigger
// should be issued in multiple calls from the client.
const HARD_BATCH_LIMIT = 25;

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

  // Resolve target quotation ids.
  const requestedLimit = Math.max(
    1,
    Math.min(HARD_BATCH_LIMIT, body.limit ?? HARD_BATCH_LIMIT)
  );
  let targetIds: string[] = [];

  if (body.quotationIds && body.quotationIds.length > 0) {
    targetIds = body.quotationIds.slice(0, HARD_BATCH_LIMIT);
  } else if (body.projectId) {
    // Pick the next N quotations in the project that DON'T already have a
    // sentiment row. Order by recency so the first batch covers what the
    // user is most likely looking at.
    const { data, error } = await supabase
      .from("quotations")
      .select("id, quotation_sentiment(quotation_id)")
      .eq("project_id", body.projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(requestedLimit * 4); // overfetch then filter; cheap.
    if (error) return errorResponse(error.message, 500);
    targetIds = (data ?? [])
      .filter((row: { quotation_sentiment: unknown[] | null }) => {
        const list = row.quotation_sentiment;
        return !list || (Array.isArray(list) && list.length === 0);
      })
      .map((row: { id: string }) => row.id)
      .slice(0, requestedLimit);
  } else {
    return errorResponse("Provide quotationIds OR projectId", 400);
  }

  if (targetIds.length === 0) {
    return jsonResponse({ ok: true, analyzed: 0, results: [] });
  }

  // Fetch quotations + the document so we can build a context window.
  const { data: rows, error: rowsErr } = await supabase
    .from("quotations")
    .select(
      `id, user_id, project_id, document_id, start_offset, end_offset, content,
       document:documents(title, kind, full_text)`
    )
    .in("id", targetIds)
    .eq("user_id", userId);

  if (rowsErr) return errorResponse(rowsErr.message, 500);
  if (!rows || rows.length === 0) {
    return errorResponse("No quotations found for the requested ids", 404);
  }

  const results: {
    quotationId: string;
    ok: boolean;
    label?: string;
    polarity?: number;
    error?: string;
  }[] = [];

  // Sequential to avoid hammering Anthropic. The UI invokes this per chunk
  // anyway when handling large projects.
  for (const raw of rows as unknown as QuotationRow[]) {
    if (!raw.content || raw.content.trim().length === 0) {
      results.push({ quotationId: raw.id, ok: false, error: "empty content" });
      continue;
    }

    const doc = Array.isArray(raw.document) ? raw.document[0] : raw.document;
    const fullText = doc?.full_text ?? null;
    const before = fullText
      ? fullText.slice(Math.max(0, raw.start_offset - 220), raw.start_offset)
      : "";
    const after = fullText
      ? fullText.slice(raw.end_offset, Math.min(fullText.length, raw.end_offset + 220))
      : "";

    try {
      const result = await callClaudeTool<SentimentToolResponse>(
        [
          {
            role: "user",
            content: sentimentPrompt({
              quote: raw.content,
              documentTitle: doc?.title ?? "(documento sin título)",
              documentKind: doc?.kind ?? "other",
              contextBefore: before,
              contextAfter: after,
            }),
          },
        ],
        {
          system: SENTIMENT_SYSTEM_PROMPT,
          toolName: "report_sentiment",
          toolDescription:
            "Devuelve la valoración afectiva (polarity, label, aspects, emotions) de la cita.",
          inputSchema: SENTIMENT_TOOL_SCHEMA,
          maxTokens: 512,
          temperature: 0.1,
        }
      );

      const sentiment = result.data;
      // Clamp polarity into the schema range; Claude occasionally drifts a hair.
      const polarity = Math.max(-1, Math.min(1, Number(sentiment.polarity) || 0));
      const label = sentiment.label;

      const { error: upsertErr } = await supabase.from("quotation_sentiment").upsert(
        {
          quotation_id: raw.id,
          user_id: raw.user_id,
          project_id: raw.project_id,
          polarity,
          label,
          aspects: (sentiment.aspects ?? [])
            .filter((a) => a && typeof a.aspect === "string")
            .map((a) => ({
              aspect: a.aspect.slice(0, 120),
              polarity: Math.max(-1, Math.min(1, Number(a.polarity) || 0)),
            })),
          emotions: (sentiment.emotions ?? [])
            .filter((e) => typeof e === "string")
            .map((e) => e.slice(0, 60)),
          model: result.model ?? CLAUDE_MODEL,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "quotation_id" }
      );
      if (upsertErr) {
        results.push({ quotationId: raw.id, ok: false, error: upsertErr.message });
        continue;
      }

      results.push({ quotationId: raw.id, ok: true, label, polarity });
    } catch (err) {
      results.push({
        quotationId: raw.id,
        ok: false,
        error: err instanceof Error ? err.message : "claude failed",
      });
    }
  }

  return jsonResponse({
    ok: true,
    analyzed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});
