// Edge Function: ai-auto-code
// Two-pass open coding with Claude:
//   1. Generate the codebook (codes + project summary) from a sample of
//      the document. One call, even for very long documents — the
//      codebook should reflect dominant themes, not exhaustive coverage.
//   2. Extract verbatim quotations and assign them to those codes.
//      For documents <= SINGLE_PASS_CHARS this is one call. For longer
//      documents the text is split into chunks and quotations are
//      collected from every chunk with offsets adjusted to the full text.
//
// This means coverage scales with document length without ever blowing
// past Claude's max_tokens or the edge function's wall-time on a single
// call.

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

// Per-chunk budget — sized to fit comfortably under Anthropic's default
// 30K input-tokens-per-minute limit when combined with the system prompt,
// the codebook in the user prompt, and tool schema overhead.
//   ~60K chars ≈ 15K tokens of document text
// + ~ 4K  tokens of system + codebook + scaffold + tool schema
// = ~19K tokens per call → leaves >10K tokens of headroom each minute.
const SINGLE_PASS_CHARS = 60_000;
// Hard cap: even with chunking, processing very long documents takes a
// long time. 600K chars (≈90 pages of dense prose) is a sensible MVP
// upper bound that fits in the 400s edge function wall-time budget.
const MAX_TOTAL_CHARS = 600_000;
// Codebook generation always uses the first slice of the document; that
// is plenty to identify the dominant themes/codes.
const CODEBOOK_SAMPLE_CHARS = 50_000;
// Cooperative client-side rate limit. Anthropic's defaults (free / Tier 1
// / Tier 2 orgs) are 30K input tokens/min for Sonnet. We watch the
// running 60-second window of input_tokens we've consumed and pause the
// next call until enough budget has freed up.
const TOKEN_BUDGET_PER_MIN = 28_000;
const RATE_WINDOW_MS = 60_000;

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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, research_question, methodology")
    .eq("id", doc.project_id)
    .eq("user_id", userId)
    .single();

  const { data: existingCodes } = await supabase
    .from("codes")
    .select("name, description")
    .eq("project_id", doc.project_id);

  const fullLength = doc.full_text.length;
  const workingText = doc.full_text.slice(0, MAX_TOTAL_CHARS);
  const truncated = fullLength > MAX_TOTAL_CHARS;

  console.log(
    `[ai-auto-code] doc=${documentId} chars=${workingText.length} (full=${fullLength}) ` +
      `truncated=${truncated} existing_codes=${existingCodes?.length ?? 0}`
  );

  // Cooperative rate-limit window: track recent input_tokens consumed
  // by THIS request so we don't blow past the org's per-minute budget.
  const usageWindow: { ts: number; tokens: number }[] = [];
  function trackUsage(tokens: number) {
    const now = Date.now();
    usageWindow.push({ ts: now, tokens });
    while (usageWindow.length && now - usageWindow[0].ts > RATE_WINDOW_MS) {
      usageWindow.shift();
    }
  }
  async function awaitBudget(estimatedTokens: number) {
    while (true) {
      const now = Date.now();
      while (usageWindow.length && now - usageWindow[0].ts > RATE_WINDOW_MS) {
        usageWindow.shift();
      }
      const used = usageWindow.reduce((s, u) => s + u.tokens, 0);
      if (used + estimatedTokens <= TOKEN_BUDGET_PER_MIN) return;
      // Wait until the oldest entry exits the window.
      const earliest = usageWindow[0];
      const waitMs = Math.max(500, RATE_WINDOW_MS - (now - earliest.ts) + 250);
      console.log(
        `[ai-auto-code] rate-limit wait ${waitMs}ms (used=${used} need=${estimatedTokens})`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  // Anthropic counts the entire prompt — system + tool schema + user.
  // 4 chars/token is the conventional approximation for English text.
  const estimateTokens = (text: string): number =>
    Math.ceil(text.length / 4) + 600;

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
    // Fail hard ONLY if we don't have any prior codebook to fall back
    // on — otherwise we can still extract quotations against the
    // existing project codes, which is way more useful than a 500.
    if (!existingCodes || existingCodes.length === 0) {
      const status = err instanceof ClaudeRateLimitError ? 429 : 500;
      return errorResponse(pass1Error, status);
    }
    console.log(
      `[ai-auto-code] pass-1 fallback: skipping codebook generation, ` +
        `reusing ${existingCodes.length} existing codes`
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

  const allQuotations: SuggestedQuotation[] = [];
  let pass2RateLimitedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, startOffset } = chunks[i];
    try {
      await awaitBudget(estimateTokens(chunkText));
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
      // Shift offsets so they map to the full document, not just the chunk.
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
    } catch (err) {
      if (err instanceof ClaudeRateLimitError) pass2RateLimitedCount++;
      console.error(
        `[ai-auto-code] pass2 chunk ${i + 1}/${chunks.length} failed:`,
        err instanceof Error ? err.message : err
      );
      // Keep going so a single bad chunk doesn't lose the whole batch.
    }
  }

  // Dedupe quotations that overlap heavily (the chunk overlap can cause
  // the same span to surface twice).
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

  // If pass-1 failed AND every pass-2 chunk also failed, there's nothing
  // to save — surface the original error instead of a 200 with empty
  // payload, which is what was creating the "no me coge citas" UX.
  if (!codebook && allQuotations.length === 0) {
    return errorResponse(
      pass1Error ??
        "Anthropic devolvió 0 citas en todos los chunks (probablemente por rate limit). Espera un minuto y reintenta.",
      pass2RateLimitedCount > 0 ? 429 : 500
    );
  }

  console.log(
    `[ai-auto-code] final codes=${cleanPayload.codes.length} ` +
      `quotes=${cleanPayload.quotations.length} ` +
      `(from ${allQuotations.length} raw, rate_limited_chunks=${pass2RateLimitedCount})`
  );

  const { data: suggestion, error: insErr } = await supabase
    .from("ai_suggestions")
    .insert({
      user_id: userId,
      project_id: doc.project_id,
      document_id: documentId,
      kind: "codebook",
      payload: {
        ...cleanPayload,
        truncated,
        source_chars: workingText.length,
        full_chars: fullLength,
        chunks: chunks.length,
        // Tell the UI we used the existing codebook because pass-1 was
        // rate-limited; lets it explain why no new codes appear.
        codebook_fallback: codebook === null,
        rate_limited_chunks: pass2RateLimitedCount,
      },
      status: "pending",
      model: model ?? CLAUDE_MODEL,
    })
    .select()
    .single();

  if (insErr) {
    console.error("[ai-auto-code] insert ai_suggestions failed:", insErr);
    return errorResponse(`Failed to save suggestion: ${insErr.message}`, 500);
  }

  console.log(`[ai-auto-code] saved suggestion ${suggestion.id}`);

  return jsonResponse({ ok: true, suggestion });
});

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
