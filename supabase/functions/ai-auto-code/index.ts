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

// Per-call budget — sized so that 3-4 consecutive calls (codebook + 2-3
// chunks) fit inside Anthropic's default 30K input-tokens/min window
// even with worst-case prose density (3.5 chars/token in Spanish).
//
//   28K chars ≈ 8.0K tokens of doc text (3.5 chars/tok worst case)
// + ~600 tokens of trimmed prompt + tool schema + codebook (~20 names)
// = ~8.6K tokens per pass-2 call.
// Pass-1 (24K codebook sample) ≈ 7.5K tokens.
// Total: codebook + 2 chunks ≈ 23-24K tokens, leaves ~6K headroom.
const SINGLE_PASS_CHARS = 28_000;
// Hard cap: even with chunking, processing very long documents takes a
// long time. 600K chars (≈90 pages of dense prose) is a sensible MVP
// upper bound that fits in the 400s edge function wall-time budget.
const MAX_TOTAL_CHARS = 600_000;
// Codebook generation always uses the first slice of the document; that
// is plenty to identify the dominant themes/codes.
const CODEBOOK_SAMPLE_CHARS = 24_000;
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

// Compact schemas: minimal property descriptions, no redundant
// constraints already in the prompt. Drop start/end offsets — the model
// never gets them right; repairQuotations() finds them via indexOf().
const CODEBOOK_TOOL_SCHEMA = {
  type: "object",
  required: ["summary", "codes"],
  properties: {
    summary: { type: "string" },
    codes: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
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
      items: {
        type: "object",
        required: ["content", "code_names"],
        properties: {
          content: { type: "string" },
          rationale: { type: "string" },
          code_names: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
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
        // Cache the system prompt + tool schema. Pass-1 only runs once
        // per job so this is a cache-write only; the savings come on
        // future jobs that run within 5 minutes of each other.
        cachePrompt: true,
      }
    );
    codebook = r1.data;
    model = r1.model;
    // Cached prefix tokens DON'T count against the per-minute Anthropic
    // rate limit, so the rate limiter only needs to track the
    // non-cached portion (input_tokens already excludes cache reads;
    // cache_creation_input_tokens IS counted by Anthropic the first
    // time but we conservatively add it as well).
    const billable =
      (r1.usage.input_tokens ?? 0) +
      (r1.usage.cache_creation_input_tokens ?? 0);
    trackUsage(billable || estimateTokens(sample));
    console.log(
      `[ai-auto-code] pass1 codes=${codebook.codes?.length ?? 0} ` +
        `in_tokens=${r1.usage.input_tokens} ` +
        `cache_r=${r1.usage.cache_read_input_tokens ?? 0} ` +
        `cache_w=${r1.usage.cache_creation_input_tokens ?? 0} ` +
        `stop=${r1.stopReason}`
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
          // Cache the system + tool schema. The first chunk writes the
          // cache; every subsequent chunk in the same job hits it,
          // which:
          //   * cuts billed input tokens by ~10x for that prefix
          //   * removes those tokens from the per-minute rate limit
          // Net effect on a 4-chunk doc: ~3K tokens saved/min budget
          // freed, which often eliminates the rate-limit wait entirely.
          cachePrompt: true,
        }
      );
      const billable =
        (r2.usage.input_tokens ?? 0) +
        (r2.usage.cache_creation_input_tokens ?? 0);
      trackUsage(billable || estimateTokens(chunkText));
      const rawQuotes = r2.data.quotations ?? [];
      const repaired = repairQuotations(chunkText, rawQuotes);
      for (const q of repaired) {
        q.start_offset += startOffset;
        q.end_offset += startOffset;
      }
      // Surface the gap between what the model proposed vs what we
      // could actually anchor in the text — this was the silent
      // failure mode that left users with codes but zero citations.
      console.log(
        `[ai-auto-code] pass2 chunk ${i + 1}/${chunks.length}: ` +
          `raw=${rawQuotes.length} kept=${repaired.length} ` +
          `in=${r2.usage.input_tokens} ` +
          `cache_r=${r2.usage.cache_read_input_tokens ?? 0} ` +
          `cache_w=${r2.usage.cache_creation_input_tokens ?? 0} ` +
          `stop=${r2.stopReason}`
      );
      if (rawQuotes.length > 0 && repaired.length === 0) {
        // Dump a single sample so we can see exactly what shape the
        // model returned next time we hit this. Truncated to keep log
        // lines under Supabase's 32K line limit.
        const sample = JSON.stringify(rawQuotes[0]).slice(0, 400);
        console.warn(
          `[ai-auto-code] all ${rawQuotes.length} raw quotes were dropped ` +
            `by repairQuotations. Sample: ${sample}`
        );
      }
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
  content?: string;
  rationale?: string;
  code_names?: string[];
  confidence?: number;
}

/**
 * Normalisation that's tolerant to the cosmetic differences Claude
 * reliably introduces when echoing text back:
 *   - smart quotes "" '' « » to plain " '
 *   - en/em dash — – to plain -
 *   - any run of whitespace (incl. \r\n, NBSP, \t) to a single space
 *   - leading/trailing whitespace stripped
 *
 * We build the normalised string AND a parallel index mapping each
 * normalised char back to the index it originated from in the source
 * text, so once we find a match we can recover REAL offsets.
 */
function normalizeForMatch(s: string): { norm: string; map: number[] } {
  const norm: string[] = [];
  const map: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    // Smart-quote / dash / NBSP normalisation.
    if (ch === "\u201C" || ch === "\u201D" || ch === "\u00AB" || ch === "\u00BB") ch = '"';
    else if (ch === "\u2018" || ch === "\u2019" || ch === "\u2032") ch = "'";
    else if (ch === "\u2014" || ch === "\u2013") ch = "-";
    else if (ch === "\u00A0" || ch === "\u202F") ch = " ";

    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (prevWasSpace) continue;
      norm.push(" ");
      map.push(i);
      prevWasSpace = true;
    } else {
      norm.push(ch);
      map.push(i);
      prevWasSpace = false;
    }
  }
  // Trim leading space.
  while (norm.length && norm[0] === " ") {
    norm.shift();
    map.shift();
  }
  // Trim trailing space.
  while (norm.length && norm[norm.length - 1] === " ") {
    norm.pop();
    map.pop();
  }
  return { norm: norm.join(""), map };
}

/**
 * Locate each model-returned quotation in the chunk text and assign
 * character offsets. We no longer ask Claude for the offsets — they're
 * unreliable and waste tokens. Instead we search by content with
 * progressively more permissive matching:
 *   1. Exact substring (fast path, hits ~70% of the time).
 *   2. Normalised whitespace + smart-quote/dash forgiveness.
 *   3. Head-prefix anchor (catches mild paraphrase).
 */
function repairQuotations(text: string, quotes: RawQuote[]) {
  const out: NonNullable<AutoCodePayload["quotations"]> = [];
  let dropped = 0;
  let normalised: { norm: string; map: number[] } | null = null;

  for (const q of quotes) {
    const content = (q.content ?? "").trim();
    if (!content || !Array.isArray(q.code_names) || q.code_names.length === 0) {
      dropped++;
      continue;
    }

    // 1. Exact match.
    let start = text.indexOf(content);
    let end: number;
    if (start !== -1) {
      end = start + content.length;
    } else {
      // 2. Normalised match. Build the source map lazily — only the
      // first miss pays the cost.
      if (!normalised) normalised = normalizeForMatch(text);
      const { norm: cNorm } = normalizeForMatch(content);
      if (cNorm.length === 0) {
        dropped++;
        continue;
      }
      const normIdx = normalised.norm.indexOf(cNorm);
      if (normIdx !== -1) {
        // Map normalised offsets back to the original text. The map
        // gives the source index of each normalised char; we want
        // the inclusive start and the source index AFTER the last
        // normalised char of the match.
        start = normalised.map[normIdx];
        const lastNormIdx = normIdx + cNorm.length - 1;
        const lastSrcIdx = normalised.map[lastNormIdx];
        end = lastSrcIdx + 1;
      } else {
        // 3. Last-resort anchor on the first ~120 chars.
        const head = content.slice(0, Math.min(120, content.length));
        const altFound = text.indexOf(head);
        if (altFound === -1) {
          // Try the head against the normalised text too.
          const { norm: headNorm } = normalizeForMatch(head);
          if (headNorm.length === 0) {
            dropped++;
            continue;
          }
          const altNorm = normalised.norm.indexOf(headNorm);
          if (altNorm === -1) {
            dropped++;
            continue;
          }
          start = normalised.map[altNorm];
          end = Math.min(text.length, start + content.length);
        } else {
          start = altFound;
          end = altFound + content.length;
        }
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
  if (dropped > 0) {
    console.warn(
      `[ai-auto-code] repairQuotations dropped ${dropped}/${quotes.length} ` +
        `quotes that could not be located in the chunk text`
    );
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
