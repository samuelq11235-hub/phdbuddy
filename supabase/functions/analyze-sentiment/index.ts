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
import { callClaudeTool, CLAUDE_MODEL, CLAUDE_HAIKU } from "../_shared/claude.ts";
import { SENTIMENT_SYSTEM_PROMPT, batchSentimentPrompt } from "../_shared/prompts.ts";

// Batched schema: Claude returns an array of per-quote results, each
// keyed back to the original input via `quotation_idx`. This lets us
// process up to BATCH_SIZE quotes in a single API call instead of one
// call per quote. ~85% reduction in per-quote overhead (system +
// schema were the dominant token cost on the per-quote variant).
const SENTIMENT_TOOL_SCHEMA = {
  type: "object",
  required: ["results"],
  properties: {
    results: {
      type: "array",
      description:
        "Un objeto por cita analizada. Conserva el quotation_idx tal y como te lo dimos.",
      items: {
        type: "object",
        required: ["quotation_idx", "polarity", "label"],
        properties: {
          quotation_idx: {
            type: "integer",
            description: "Índice (1-based) de la cita correspondiente.",
          },
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
                aspect: { type: "string" },
                polarity: { type: "number" },
              },
            },
          },
          emotions: {
            type: "array",
            description: "Hasta 3 emociones primarias detectadas.",
            items: { type: "string" },
          },
        },
      },
    },
  },
};

interface SentimentResultItem {
  quotation_idx: number;
  polarity: number;
  label: "positive" | "negative" | "neutral" | "mixed";
  aspects?: { aspect: string; polarity: number }[];
  emotions?: string[];
}
interface SentimentToolResponse {
  results: SentimentResultItem[];
}

// 10 quotes per batch is a sweet spot: enough to amortize the system
// prompt + tool schema (~400 tokens) across many quotes, but small
// enough that one rate-limit error doesn't lose 25 quotes' work.
const BATCH_SIZE = 10;

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

  // Skip empties and build the batch list with stable indices. We keep
  // the original QuotationRow alongside its 1-based idx so we can map
  // Claude's `quotation_idx` back to the row to upsert.
  const validRows: { idx: number; row: QuotationRow; before: string; after: string }[] = [];
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
    validRows.push({ idx: validRows.length + 1, row: raw, before, after });
  }

  // Process in batches of BATCH_SIZE. Each batch is one Claude call that
  // returns N sentiment objects keyed by quotation_idx.
  for (let cursor = 0; cursor < validRows.length; cursor += BATCH_SIZE) {
    const batch = validRows.slice(cursor, cursor + BATCH_SIZE);
    // Re-number the batch from 1 so the prompt's idx column always
    // starts at 1 and Claude's grounding stays consistent.
    const numbered = batch.map((b, i) => ({
      ...b,
      promptIdx: i + 1,
    }));

    let resp: { results?: SentimentResultItem[] } | null = null;
    let model = CLAUDE_MODEL;
    try {
      const result = await callClaudeTool<SentimentToolResponse>(
        [
          {
            role: "user",
            content: batchSentimentPrompt({
              quotes: numbered.map((b) => {
                const doc = Array.isArray(b.row.document)
                  ? b.row.document[0]
                  : b.row.document;
                return {
                  idx: b.promptIdx,
                  quote: b.row.content,
                  documentTitle: doc?.title ?? "(documento sin título)",
                  documentKind: doc?.kind ?? "other",
                  contextBefore: b.before,
                  contextAfter: b.after,
                };
              }),
            }),
          },
        ],
        {
          // Sentiment is a shallow classification task with a fixed
          // label set — Haiku 4.5 nails it and is ~3x cheaper than
          // Sonnet on both input and output.
          model: CLAUDE_HAIKU,
          system: SENTIMENT_SYSTEM_PROMPT,
          toolName: "report_sentiment_batch",
          toolDescription:
            "Devuelve un array `results` con la valoración afectiva (polarity, label, aspects, emotions) de cada cita, identificada por quotation_idx.",
          inputSchema: SENTIMENT_TOOL_SCHEMA,
          // Each result item is ~80-180 output tokens. 2048 leaves room
          // for the full BATCH_SIZE × emotions/aspects arrays.
          maxTokens: 2048,
          temperature: 0.1,
          // System + schema are byte-identical across all batches in a
          // run; caching cuts the per-batch input bill by ~80% after
          // the first batch.
          cachePrompt: true,
        }
      );
      resp = result.data;
      model = result.model ?? CLAUDE_HAIKU;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "claude failed";
      // The whole batch fails together when Claude itself fails — mark
      // each row as failed so the user can retry just the laggards.
      for (const b of batch) {
        results.push({ quotationId: b.row.id, ok: false, error: msg });
      }
      continue;
    }

    const byIdx = new Map<number, SentimentResultItem>();
    for (const r of resp?.results ?? []) {
      if (typeof r?.quotation_idx === "number") byIdx.set(r.quotation_idx, r);
    }

    for (const b of numbered) {
      const sentiment = byIdx.get(b.promptIdx);
      if (!sentiment) {
        results.push({
          quotationId: b.row.id,
          ok: false,
          error: "no result returned for this idx",
        });
        continue;
      }
      const polarity = Math.max(
        -1,
        Math.min(1, Number(sentiment.polarity) || 0)
      );
      const label = sentiment.label;

      const { error: upsertErr } = await supabase.from("quotation_sentiment").upsert(
        {
          quotation_id: b.row.id,
          user_id: b.row.user_id,
          project_id: b.row.project_id,
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
          model,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "quotation_id" }
      );
      if (upsertErr) {
        results.push({
          quotationId: b.row.id,
          ok: false,
          error: upsertErr.message,
        });
        continue;
      }
      results.push({ quotationId: b.row.id, ok: true, label, polarity });
    }
  }

  return jsonResponse({
    ok: true,
    analyzed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});
