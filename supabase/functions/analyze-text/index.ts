// =====================================================
// PHDBuddy F13 — analyze-text edge function
// =====================================================
// One endpoint, three classic non-IA analysis tools:
//
//   POST /analyze-text  body: { projectId, mode: "frequency", topN?, documentIds? }
//   POST /analyze-text  body: { projectId, mode: "kwic",      term, context?, documentIds? }
//   POST /analyze-text  body: { projectId, mode: "cooccurrence", scope?: "quotation"|"document", documentIds? }
//
// Why one function instead of three? They share the same pre-fetch
// (project membership check + document or quotation pull). Splitting
// would triple the cold-start cost and the deploy surface.
//
// Performance notes:
// - Word frequency on a 100-page PDF is ~80k tokens; a Map<string, number>
//   over that is ~50ms in V8. We cap at the top 500 to keep response
//   small.
// - KWIC scans full_text linearly; for huge corpora (>10 MB total)
//   you'd want pg_trgm indices, but this is fine for a single-researcher
//   project.
// - Co-occurrence at the *quotation* scope is exact (counts pairs that
//   share a quotation_id); at *document* scope it's the looser "appear
//   in same document" notion ATLAS gives by default.
// =====================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { tokenize } from "../_shared/stopwords.ts";

interface BaseInput {
  projectId: string;
  documentIds?: string[];
}
interface FrequencyInput extends BaseInput {
  mode: "frequency";
  topN?: number;
}
interface KwicInput extends BaseInput {
  mode: "kwic";
  term: string;
  context?: number; // chars on each side, default 50
  caseSensitive?: boolean;
}
interface CoocInput extends BaseInput {
  mode: "cooccurrence";
  scope?: "quotation" | "document";
}
type Input = FrequencyInput | KwicInput | CoocInput;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let userId: string;
  try {
    ({ userId } = await getUserFromRequest(req));
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unauthorized", 401);
  }

  let input: Input;
  try {
    input = (await req.json()) as Input;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!input?.projectId || !input.mode) {
    return errorResponse("projectId and mode required");
  }

  const supabase = getServiceClient();

  // Membership check (we run as service-role for read perf, so we have
  // to gate explicitly).
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", input.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return errorResponse("Forbidden", 403);

  if (input.mode === "frequency") {
    return await handleFrequency(supabase, input);
  }
  if (input.mode === "kwic") {
    return await handleKwic(supabase, input);
  }
  if (input.mode === "cooccurrence") {
    return await handleCooccurrence(supabase, input);
  }
  return errorResponse(`Unknown mode: ${(input as { mode?: string }).mode}`);
});

// ---------- frequency ---------------------------------------------------

async function handleFrequency(
  supabase: ReturnType<typeof getServiceClient>,
  input: FrequencyInput
): Promise<Response> {
  const topN = Math.min(Math.max(input.topN ?? 200, 10), 1000);
  let query = supabase
    .from("documents")
    .select("id, title, full_text")
    .eq("project_id", input.projectId)
    .not("full_text", "is", null);
  if (input.documentIds && input.documentIds.length > 0) {
    query = query.in("id", input.documentIds);
  }
  const { data: docs, error } = await query;
  if (error) return errorResponse(error.message, 500);

  const totals = new Map<string, number>();
  // Per-document presence count gives us a "document frequency" so the
  // UI can compute tf-idf if it wants to. Cheap to track.
  const docFreq = new Map<string, number>();
  let totalTokens = 0;

  for (const doc of docs ?? []) {
    if (!doc.full_text) continue;
    const tokens = tokenize(doc.full_text as string);
    totalTokens += tokens.length;
    const seenInThisDoc = new Set<string>();
    for (const t of tokens) {
      totals.set(t, (totals.get(t) ?? 0) + 1);
      if (!seenInThisDoc.has(t)) {
        seenInThisDoc.add(t);
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
    }
  }

  const ranked = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term, count]) => ({
      term,
      count,
      documentFrequency: docFreq.get(term) ?? 0,
    }));

  return jsonResponse({
    totalTokens,
    uniqueTerms: totals.size,
    documentsAnalyzed: docs?.length ?? 0,
    terms: ranked,
  });
}

// ---------- kwic --------------------------------------------------------

async function handleKwic(
  supabase: ReturnType<typeof getServiceClient>,
  input: KwicInput
): Promise<Response> {
  const term = (input.term ?? "").trim();
  if (!term) return errorResponse("term required");
  const context = Math.min(Math.max(input.context ?? 60, 10), 300);
  const caseSensitive = !!input.caseSensitive;

  let query = supabase
    .from("documents")
    .select("id, title, full_text")
    .eq("project_id", input.projectId)
    .not("full_text", "is", null);
  if (input.documentIds && input.documentIds.length > 0) {
    query = query.in("id", input.documentIds);
  }
  const { data: docs, error } = await query;
  if (error) return errorResponse(error.message, 500);

  const matches: Array<{
    documentId: string;
    documentTitle: string;
    offset: number;
    left: string;
    match: string;
    right: string;
  }> = [];
  // Cap the response so a worst-case query ("the") doesn't blow up
  // memory on the client.
  const HARD_CAP = 500;

  // Build a regex once — escape user input so they can't inject regex.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, caseSensitive ? "g" : "gi");

  outer: for (const doc of docs ?? []) {
    const text = (doc.full_text as string | null) ?? "";
    if (!text) continue;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const i = m.index;
      const left = text.slice(Math.max(0, i - context), i);
      const match = text.slice(i, i + m[0].length);
      const right = text.slice(i + m[0].length, i + m[0].length + context);
      matches.push({
        documentId: doc.id as string,
        documentTitle: (doc.title as string) ?? "",
        offset: i,
        left,
        match,
        right,
      });
      if (matches.length >= HARD_CAP) break outer;
      // Defensive: zero-width matches would loop forever. Won't happen
      // with literal escapes, but kept for safety.
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }

  return jsonResponse({
    term,
    context,
    caseSensitive,
    capped: matches.length >= HARD_CAP,
    matches,
  });
}

// ---------- co-occurrence -----------------------------------------------

async function handleCooccurrence(
  supabase: ReturnType<typeof getServiceClient>,
  input: CoocInput
): Promise<Response> {
  const scope = input.scope ?? "quotation";

  const [{ data: codes }, { data: quotaRowsRaw }] = await Promise.all([
    supabase
      .from("codes")
      .select("id, name, color")
      .eq("project_id", input.projectId),
    supabase
      .from("quotations")
      .select("id, document_id")
      .eq("project_id", input.projectId),
  ]);
  const codeList = (codes ?? []) as Array<{ id: string; name: string; color: string }>;

  let quotaRows = (quotaRowsRaw ?? []) as Array<{ id: string; document_id: string }>;
  if (input.documentIds && input.documentIds.length > 0) {
    const docIdSet = new Set(input.documentIds);
    quotaRows = quotaRows.filter((q) => docIdSet.has(q.document_id));
  }
  const quotaIds = quotaRows.map((q) => q.id);

  if (quotaIds.length === 0 || codeList.length === 0) {
    return jsonResponse({ codes: codeList, scope, matrix: [] });
  }

  // quotation_codes is not project-scoped; fetch in chunks filtered by
  // project quotation IDs (same pattern as execute-query).
  const codingsByQuotation = new Map<string, Set<string>>();
  const CHUNK = 400;
  for (let i = 0; i < quotaIds.length; i += CHUNK) {
    const slice = quotaIds.slice(i, i + CHUNK);
    const { data: qc } = await supabase
      .from("quotation_codes")
      .select("quotation_id, code_id")
      .in("quotation_id", slice);
    for (const row of (qc ?? []) as Array<{ quotation_id: string; code_id: string }>) {
      let s = codingsByQuotation.get(row.quotation_id);
      if (!s) {
        s = new Set();
        codingsByQuotation.set(row.quotation_id, s);
      }
      s.add(row.code_id);
    }
  }

  // Pair counter using a string key "minId|maxId" to dedupe directionless.
  const pairCount = new Map<string, number>();
  // For document scope, accumulate codes-per-document first.
  if (scope === "document") {
    const codesByDoc = new Map<string, Set<string>>();
    for (const q of quotaRows) {
      const codings = codingsByQuotation.get(q.id);
      if (!codings) continue;
      let s = codesByDoc.get(q.document_id);
      if (!s) {
        s = new Set();
        codesByDoc.set(q.document_id, s);
      }
      for (const c of codings) s.add(c);
    }
    for (const codings of codesByDoc.values()) {
      addPairs(codings, pairCount);
    }
  } else {
    for (const codings of codingsByQuotation.values()) {
      addPairs(codings, pairCount);
    }
  }

  // Frequency per code (so the UI can normalize / show diagonal).
  const codeFreq = new Map<string, number>();
  for (const codings of codingsByQuotation.values()) {
    for (const c of codings) codeFreq.set(c, (codeFreq.get(c) ?? 0) + 1);
  }

  const matrix: Array<{ a: string; b: string; count: number }> = [];
  for (const [key, count] of pairCount.entries()) {
    const [a, b] = key.split("|");
    matrix.push({ a, b, count });
  }
  matrix.sort((x, y) => y.count - x.count);

  return jsonResponse({
    scope,
    codes: codeList.map((c) => ({
      ...c,
      count: codeFreq.get(c.id) ?? 0,
    })),
    matrix,
  });
}

function addPairs(codings: Set<string>, pairCount: Map<string, number>): void {
  if (codings.size < 2) return;
  const arr = Array.from(codings);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i] < arr[j] ? arr[i] : arr[j];
      const b = arr[i] < arr[j] ? arr[j] : arr[i];
      const key = `${a}|${b}`;
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }
}
