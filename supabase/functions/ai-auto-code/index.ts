// Edge Function: ai-auto-code
// Two-pass open coding with Claude — runs ASYNCHRONOUSLY:
//   1. The HTTP handler validates the request, creates a `pending` row in
//      ai_suggestions with payload.processing=true, and returns it
//      immediately so the client can show a non-blocking spinner.
//   2. The actual Claude work runs in EdgeRuntime.waitUntil() so the
//      client connection can close even if the job takes minutes
//      (Anthropic rate-limit waits, multiple chunks, etc.).
//   3. When the job finishes (success or failure) we UPDATE the same row
//      with the final payload. The frontend polls useDocumentSuggestions
//      and renders the dialog as soon as payload.processing flips off.
//
// Why asynchronous?
//   Supabase edge functions have a wall-clock budget (~150s by default).
//   When Anthropic rate-limits us we may need to sleep ~60s between
//   chunks; on a 3-chunk doc that easily blows the budget and the
//   client-side fetch hangs until it 504s. The background-task pattern
//   removes the wall-clock pressure entirely.

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import {
  callClaudeTool,
  CLAUDE_MODEL,
  ClaudeRateLimitError,
} from "../_shared/claude.ts";
import {
  AUTO_CODE_SYSTEM_PROMPT,
  autoCodePrompt,
  EXTRACT_QUOTATIONS_SYSTEM_PROMPT,
  extractQuotationsPrompt,
} from "../_shared/prompts.ts";
import type { AutoCodePayload, SuggestedCode, SuggestedQuotation } from "../_shared/types.ts";

interface RequestBody {
  documentId: string;
}

// Per-chunk budget — sized so that THREE consecutive calls (codebook +
// 2 chunks) always fit inside Anthropic's default 30K input-tokens-per-
// minute window. The previous 60K-char chunks were ~16K tokens each,
// which meant ANY two-chunk document had to sit and wait 60s.
//
//   ~22K chars ≈ 6K tokens of document text (real ratio ~3.7-3.8)
// + ~ 1.5K     of system + codebook + scaffold + tool schema
// = ~ 7.5K tokens per call → 3+ calls/min fits cleanly under 30K.
const SINGLE_PASS_CHARS = 22_000;
// Hard cap: even with chunking, processing very long documents takes a
// long time. 600K chars (≈90 pages of dense prose) is a sensible MVP
// upper bound that fits in the 400s edge function wall-time budget.
const MAX_TOTAL_CHARS = 600_000;
// Codebook generation always uses the first slice of the document; that
// is plenty to identify the dominant themes/codes. 18K chars is enough
// representative material without eating the per-minute budget.
const CODEBOOK_SAMPLE_CHARS = 18_000;
// Cooperative client-side rate limit. Anthropic's defaults (free / Tier 1
// / Tier 2 orgs) are 30K input tokens/min for Sonnet. We watch the
// running 60-second window of input_tokens we've consumed and pause the
// next call until enough budget has freed up. Setting this just below
// the hard limit gives headroom for token-count estimation noise.
const TOKEN_BUDGET_PER_MIN = 27_000;
const RATE_WINDOW_MS = 60_000;
// Approximation: Spanish + JSON tool schemas average ~3.4 chars/token.
// 4 was too pessimistic and caused us to think we were over budget when
// we actually weren't. Tuned against real usage logs.
const CHARS_PER_TOKEN_ESTIMATE = 3.6;
const PROMPT_OVERHEAD_TOKENS = 400;

const CODEBOOK_TOOL_SCHEMA = {
  type: "object",
  required: ["summary", "codes"],
  properties: {
    summary: {
      type: "string",
      description: "Un párrafo (máx. 80 palabras) describiendo los temas dominantes.",
    },
    codes: {
      type: "array",
      description: "Libro de códigos inicial (8-20 códigos, máx. 25).",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Etiqueta corta (2-5 palabras)." },
          description: { type: "string", description: "Una sola oración corta (máx. 20 palabras)." },
          color: { type: "string", description: "Color hexadecimal opcional (#RRGGBB)." },
        },
      },
    },
  },
};

const QUOTATIONS_TOOL_SCHEMA = {
  type: "object",
  required: ["quotations"],
  properties: {
    quotations: {
      type: "array",
      description:
        "Citas literales del texto que respaldan los códigos del codebook proporcionado.",
      items: {
        type: "object",
        required: ["start_offset", "end_offset", "content", "code_names"],
        properties: {
          start_offset: { type: "integer", description: "Offset de carácter (basado en 0)." },
          end_offset: { type: "integer", description: "Offset de carácter (exclusivo)." },
          content: {
            type: "string",
            description: "Subcadena literal del texto (1-4 oraciones, 15-200 palabras).",
          },
          rationale: { type: "string", description: "Una oración explicando por qué importa." },
          code_names: {
            type: "array",
            items: { type: "string" },
            description: "Códigos del codebook proporcionado.",
          },
          confidence: { type: "number", description: "Confianza entre 0 y 1." },
        },
      },
    },
  },
};

interface CodebookOnly {
  summary: string;
  codes: SuggestedCode[];
}

interface QuotationsOnly {
  quotations: SuggestedQuotation[];
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

  const { documentId } = body;
  if (!documentId) return errorResponse("Missing documentId", 400);

  const supabase = getServiceClient();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, user_id, project_id, title, kind, full_text, status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();

  if (docErr || !doc) return errorResponse("Document not found", 404);
  if (!doc.full_text || doc.full_text.length < 50) {
    return errorResponse("Document has not been processed yet", 400);
  }

  // Discard any stale `processing` row from a previous attempt that
  // crashed silently — otherwise the UI would forever think a job is
  // running and never let the user retry.
  await supabase
    .from("ai_suggestions")
    .delete()
    .eq("document_id", documentId)
    .eq("kind", "codebook")
    .eq("status", "pending")
    .filter("payload->>processing", "eq", "true");

  const fullLength = doc.full_text.length;
  const workingText = doc.full_text.slice(0, MAX_TOTAL_CHARS);
  const truncated = fullLength > MAX_TOTAL_CHARS;

  // Insert the placeholder suggestion FIRST so the client gets a row id
  // it can poll. The actual heavy work runs in the background.
  const { data: suggestion, error: insErr } = await supabase
    .from("ai_suggestions")
    .insert({
      user_id: userId,
      project_id: doc.project_id,
      document_id: documentId,
      kind: "codebook",
      payload: {
        summary: "",
        codes: [],
        quotations: [],
        processing: true,
        started_at: new Date().toISOString(),
        source_chars: workingText.length,
        full_chars: fullLength,
        truncated,
        chunks: 0,
        // Hints the UI shows a "preparing" message instead of empty.
        progress: {
          stage: "queued",
          chunks_done: 0,
          chunks_total: 0,
        },
      },
      status: "pending",
      model: CLAUDE_MODEL,
    })
    .select()
    .single();

  if (insErr || !suggestion) {
    console.error("[ai-auto-code] insert placeholder failed:", insErr);
    return errorResponse(`Failed to start auto-code job: ${insErr?.message}`, 500);
  }

  console.log(
    `[ai-auto-code] queued suggestion=${suggestion.id} doc=${documentId} ` +
      `chars=${workingText.length} (full=${fullLength}) truncated=${truncated}`
  );

  // Run the heavy job in the background. EdgeRuntime keeps the worker
  // alive past the response. Errors and progress are written back into
  // the same row.
  EdgeRuntime.waitUntil(
    runAutoCodeJob({
      supabase,
      userId,
      doc,
      workingText,
      fullLength,
      truncated,
      suggestionId: suggestion.id,
    }).catch(async (err) => {
      const message = err instanceof Error ? err.message : "auto-code job crashed";
      console.error("[ai-auto-code] background crash:", message);
      await supabase
        .from("ai_suggestions")
        .update({
          payload: {
            summary: "",
            codes: [],
            quotations: [],
            processing: false,
            error: message,
          },
        })
        .eq("id", suggestion.id);
    })
  );

  // Return the placeholder immediately so the client can start polling.
  return jsonResponse({ ok: true, suggestion });
});

interface JobInput {
  supabase: ReturnType<typeof getServiceClient>;
  userId: string;
  doc: {
    id: string;
    user_id: string;
    project_id: string;
    title: string;
    kind: string | null;
    full_text: string | null;
  };
  workingText: string;
  fullLength: number;
  truncated: boolean;
  suggestionId: string;
}

async function runAutoCodeJob(input: JobInput) {
  const { supabase, doc, workingText, fullLength, truncated, suggestionId } = input;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, research_question, methodology")
    .eq("id", doc.project_id)
    .single();

  const { data: existingCodes } = await supabase
    .from("codes")
    .select("name, description")
    .eq("project_id", doc.project_id);

  // Cooperative rate-limit window: track recent input_tokens consumed
  // by THIS job so we don't blow past the org's per-minute budget.
  const usageWindow: { ts: number; tokens: number }[] = [];
  function trackUsage(tokens: number) {
    const now = Date.now();
    usageWindow.push({ ts: now, tokens });
    while (usageWindow.length && now - usageWindow[0].ts > RATE_WINDOW_MS) {
      usageWindow.shift();
    }
  }
  async function awaitBudget(estimatedTokens: number, onWait?: (ms: number) => void) {
    while (true) {
      const now = Date.now();
      while (usageWindow.length && now - usageWindow[0].ts > RATE_WINDOW_MS) {
        usageWindow.shift();
      }
      const used = usageWindow.reduce((s, u) => s + u.tokens, 0);
      if (used + estimatedTokens <= TOKEN_BUDGET_PER_MIN) return;
      // If a single call exceeds the per-minute budget by itself there's
      // no wait that will make it fit — let the request go through and
      // rely on Anthropic's own 429 + Retry-After to handle it.
      if (usageWindow.length === 0) {
        console.warn(
          `[ai-auto-code] estimated ${estimatedTokens} tokens exceeds ` +
            `per-minute budget (${TOKEN_BUDGET_PER_MIN}); proceeding anyway`
        );
        return;
      }
      const earliest = usageWindow[0];
      const waitMs = Math.max(500, RATE_WINDOW_MS - (now - earliest.ts) + 250);
      console.log(
        `[ai-auto-code] rate-limit wait ${waitMs}ms (used=${used} need=${estimatedTokens})`
      );
      onWait?.(waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const estimateTokens = (text: string): number =>
    Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE) + PROMPT_OVERHEAD_TOKENS;

  async function reportProgress(progress: {
    stage: string;
    chunks_done: number;
    chunks_total: number;
    waiting_ms?: number;
  }) {
    // Best-effort progress update; we don't await retries — the client
    // will get the next progress write or the final payload anyway.
    await supabase
      .from("ai_suggestions")
      .update({
        payload: {
          summary: "",
          codes: [],
          quotations: [],
          processing: true,
          progress,
          source_chars: workingText.length,
          full_chars: fullLength,
          truncated,
        },
      })
      .eq("id", suggestionId);
  }

  await reportProgress({ stage: "codebook", chunks_done: 0, chunks_total: 0 });

  // ---------- PASS 1: codebook from a representative sample ----------
  let codebook: CodebookOnly | null = null;
  let model = CLAUDE_MODEL;
  let pass1Error: string | null = null;
  try {
    const sample = workingText.slice(0, CODEBOOK_SAMPLE_CHARS);
    await awaitBudget(estimateTokens(sample));
    const r1 = await callClaudeTool<CodebookOnly>(
      [
        {
          role: "user",
          content: autoCodePrompt({
            documentText: sample,
            documentTitle: doc.title,
            documentKind: doc.kind ?? "other",
            researchQuestion: project?.research_question ?? null,
            methodology: project?.methodology ?? null,
            existingCodes: existingCodes ?? [],
          }),
        },
      ],
      {
        system: AUTO_CODE_SYSTEM_PROMPT,
        toolName: "submit_codebook",
        toolDescription:
          "Devuelve el libro de códigos propuesto (sin citas — esas vendrán en un segundo paso).",
        inputSchema: CODEBOOK_TOOL_SCHEMA,
        maxTokens: 4000,
        temperature: 0.2,
      }
    );
    codebook = r1.data;
    model = r1.model;
    trackUsage(r1.usage.input_tokens ?? estimateTokens(sample));
    console.log(
      `[ai-auto-code] pass1 codes=${codebook.codes?.length ?? 0} ` +
        `in_tokens=${r1.usage.input_tokens} stop=${r1.stopReason}`
    );
  } catch (err) {
    pass1Error = err instanceof Error ? err.message : "Claude pass-1 failed";
    console.error("[ai-auto-code] pass-1 failed:", pass1Error);
    if (!existingCodes || existingCodes.length === 0) {
      // Nothing to fall back on — surface the error and stop.
      await supabase
        .from("ai_suggestions")
        .update({
          payload: {
            summary: "",
            codes: [],
            quotations: [],
            processing: false,
            error: pass1Error,
            rate_limited:
              err instanceof ClaudeRateLimitError ? true : undefined,
          },
        })
        .eq("id", suggestionId);
      return;
    }
    console.log(
      `[ai-auto-code] pass-1 fallback: reusing ${existingCodes.length} existing codes`
    );
  }

  const unionCodebook = dedupeCodes([
    ...(existingCodes ?? []).map((c) => ({ name: c.name, description: c.description ?? null })),
    ...((codebook?.codes ?? []) as SuggestedCode[]).map((c) => ({
      name: c.name,
      description: c.description ?? null,
    })),
  ]);

  // ---------- PASS 2: quotations from every chunk ----------
  const chunks = chunkDocument(workingText, SINGLE_PASS_CHARS);
  console.log(`[ai-auto-code] pass2 chunks=${chunks.length}`);
  await reportProgress({
    stage: "quotations",
    chunks_done: 0,
    chunks_total: chunks.length,
  });

  const allQuotations: SuggestedQuotation[] = [];
  let pass2RateLimitedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, startOffset } = chunks[i];
    try {
      await awaitBudget(estimateTokens(chunkText), async (waitMs) => {
        await reportProgress({
          stage: "quotations",
          chunks_done: i,
          chunks_total: chunks.length,
          waiting_ms: waitMs,
        });
      });
      const r2 = await callClaudeTool<QuotationsOnly>(
        [
          {
            role: "user",
            content: extractQuotationsPrompt({
              documentText: chunkText,
              documentTitle: doc.title,
              documentKind: doc.kind ?? "other",
              researchQuestion: project?.research_question ?? null,
              codebook: unionCodebook,
              targetCount: chunks.length === 1 ? 12 : 8,
            }),
          },
        ],
        {
          system: EXTRACT_QUOTATIONS_SYSTEM_PROMPT,
          toolName: "submit_quotations",
          toolDescription:
            "Devuelve las citas literales seleccionadas y los códigos asignados.",
          inputSchema: QUOTATIONS_TOOL_SCHEMA,
          maxTokens: 8000,
          temperature: 0.2,
        }
      );
      trackUsage(r2.usage.input_tokens ?? estimateTokens(chunkText));
      const repaired = repairQuotations(chunkText, r2.data.quotations ?? []);
      for (const q of repaired) {
        q.start_offset += startOffset;
        q.end_offset += startOffset;
      }
      console.log(
        `[ai-auto-code] pass2 chunk ${i + 1}/${chunks.length}: ` +
          `quotes=${repaired.length} in_tokens=${r2.usage.input_tokens} ` +
          `stop=${r2.stopReason}`
      );
      allQuotations.push(...repaired);
      await reportProgress({
        stage: "quotations",
        chunks_done: i + 1,
        chunks_total: chunks.length,
      });
    } catch (err) {
      if (err instanceof ClaudeRateLimitError) pass2RateLimitedCount++;
      console.error(
        `[ai-auto-code] pass2 chunk ${i + 1}/${chunks.length} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const dedupedQuotations = dedupeQuotations(allQuotations);

  const cleanPayload: AutoCodePayload = {
    summary: codebook?.summary ?? "",
    codes: (codebook?.codes ?? []).map((c) => ({
      name: c.name?.trim() || "Untitled",
      description: c.description?.trim(),
      color: c.color,
    })),
    quotations: dedupedQuotations,
  };

  // If we have absolutely nothing to show, surface a clear error instead
  // of a misleading "0 codes / 0 citations" empty success.
  if (!codebook && allQuotations.length === 0) {
    await supabase
      .from("ai_suggestions")
      .update({
        payload: {
          summary: "",
          codes: [],
          quotations: [],
          processing: false,
          error:
            pass1Error ??
            "Anthropic devolvió 0 citas en todos los chunks (rate limit). Espera un minuto y reintenta.",
          rate_limited_chunks: pass2RateLimitedCount,
        },
        model: model ?? CLAUDE_MODEL,
      })
      .eq("id", suggestionId);
    return;
  }

  console.log(
    `[ai-auto-code] final codes=${cleanPayload.codes.length} ` +
      `quotes=${cleanPayload.quotations.length} ` +
      `(rate_limited_chunks=${pass2RateLimitedCount})`
  );

  const { error: updErr } = await supabase
    .from("ai_suggestions")
    .update({
      payload: {
        ...cleanPayload,
        truncated,
        source_chars: workingText.length,
        full_chars: fullLength,
        chunks: chunks.length,
        codebook_fallback: codebook === null,
        rate_limited_chunks: pass2RateLimitedCount,
        processing: false,
      },
      model: model ?? CLAUDE_MODEL,
    })
    .eq("id", suggestionId);

  if (updErr) {
    console.error("[ai-auto-code] final update failed:", updErr);
  } else {
    console.log(`[ai-auto-code] suggestion ${suggestionId} ready`);
  }
}

interface RawQuote {
  start_offset?: number;
  end_offset?: number;
  content?: string;
  rationale?: string;
  code_names?: string[];
  confidence?: number;
}

function repairQuotations(text: string, quotes: RawQuote[]) {
  const out: NonNullable<AutoCodePayload["quotations"]> = [];
  for (const q of quotes) {
    const content = (q.content ?? "").trim();
    if (!content || !Array.isArray(q.code_names) || q.code_names.length === 0) continue;

    let start = typeof q.start_offset === "number" ? q.start_offset : -1;
    let end = typeof q.end_offset === "number" ? q.end_offset : -1;

    const slice = start >= 0 && end > start ? text.slice(start, end) : "";
    if (slice.trim() !== content) {
      const found = text.indexOf(content);
      if (found === -1) {
        const head = content.slice(0, Math.min(120, content.length));
        const altFound = text.indexOf(head);
        if (altFound === -1) continue;
        start = altFound;
        end = Math.min(text.length, altFound + content.length);
      } else {
        start = found;
        end = found + content.length;
      }
    }

    out.push({
      start_offset: start,
      end_offset: end,
      content: text.slice(start, end),
      rationale: q.rationale,
      code_names: q.code_names.map((n) => n.trim()).filter(Boolean),
      confidence: typeof q.confidence === "number" ? q.confidence : undefined,
    });
  }
  return out;
}

/**
 * Split text into roughly equal chunks of `targetSize` characters,
 * preferring paragraph boundaries (double newline) when possible.
 * Returns each chunk along with its starting offset in the original text
 * so we can later map quotation offsets back to the full document.
 */
function chunkDocument(
  text: string,
  targetSize: number
): { text: string; startOffset: number }[] {
  if (text.length <= targetSize) return [{ text, startOffset: 0 }];

  const chunks: { text: string; startOffset: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= targetSize) {
      chunks.push({ text: text.slice(cursor), startOffset: cursor });
      break;
    }
    let end = cursor + targetSize;
    // Try to break on a paragraph boundary within the last 5K chars.
    const window = text.slice(end - 5000, end + 5000);
    const localBreak = window.lastIndexOf("\n\n");
    if (localBreak !== -1) {
      end = end - 5000 + localBreak;
    } else {
      // Fall back to a single newline or sentence end.
      const altBreak = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(".\n")
      );
      if (altBreak !== -1) end = end - 5000 + altBreak;
    }
    chunks.push({ text: text.slice(cursor, end), startOffset: cursor });
    cursor = end;
  }
  return chunks;
}

function dedupeCodes(
  list: { name: string; description: string | null }[]
): { name: string; description: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; description: string | null }[] = [];
  for (const c of list) {
    const k = c.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * Drop quotations that overlap a previously kept one by more than 70%.
 * Cheap O(n²) check — n is in the dozens, not thousands.
 */
function dedupeQuotations(list: SuggestedQuotation[]): SuggestedQuotation[] {
  const sorted = [...list].sort((a, b) => a.start_offset - b.start_offset);
  const kept: SuggestedQuotation[] = [];
  for (const q of sorted) {
    let isDupe = false;
    for (const k of kept) {
      const overlap = Math.max(
        0,
        Math.min(q.end_offset, k.end_offset) - Math.max(q.start_offset, k.start_offset)
      );
      const span = Math.min(q.end_offset - q.start_offset, k.end_offset - k.start_offset);
      if (span > 0 && overlap / span > 0.7) {
        // Merge code_names from the duplicate into the kept one.
        const merged = new Set([...k.code_names, ...q.code_names]);
        k.code_names = [...merged];
        isDupe = true;
        break;
      }
    }
    if (!isDupe) kept.push(q);
  }
  return kept;
}
