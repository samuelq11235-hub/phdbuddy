// Edge Function: apply-suggestion
// Materialize an `ai_suggestions` row of kind="codebook" into real codes,
// quotations and quotation_codes rows (review-then-accept workflow).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { embedTexts } from "../_shared/voyage.ts";
import type { AutoCodePayload, SuggestedCode, SuggestedQuotation } from "../_shared/types.ts";

interface RequestBody {
  suggestionId: string;
  acceptedCodeNames?: string[]; // if provided, only these codes from the payload are applied
  acceptedQuotationIndices?: number[]; // if provided, only these payload.quotations[i] are applied
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

  const { suggestionId, acceptedCodeNames, acceptedQuotationIndices } = body;
  if (!suggestionId) return errorResponse("Missing suggestionId", 400);

  const supabase = getServiceClient();

  const { data: suggestion, error: sErr } = await supabase
    .from("ai_suggestions")
    .select("id, user_id, project_id, document_id, kind, payload, status")
    .eq("id", suggestionId)
    .eq("user_id", userId)
    .single();

  if (sErr || !suggestion) return errorResponse("Suggestion not found", 404);
  if (suggestion.status === "applied") {
    return jsonResponse({ ok: true, alreadyApplied: true });
  }
  if (suggestion.kind !== "codebook") {
    return errorResponse("Only codebook suggestions can be applied this way", 400);
  }

  const payload = suggestion.payload as AutoCodePayload;
  const codes: SuggestedCode[] = (payload.codes ?? []).filter((c) =>
    acceptedCodeNames ? acceptedCodeNames.includes(c.name) : true
  );
  const quotations: SuggestedQuotation[] = (payload.quotations ?? []).filter((_, i) =>
    acceptedQuotationIndices ? acceptedQuotationIndices.includes(i) : true
  );

  // 1. Upsert codes (preserve any existing codes — name is unique per project+parent)
  const codeIdByName = new Map<string, string>();

  // First pull any pre-existing codes that match by name so we don't create dupes.
  const { data: existingCodes } = await supabase
    .from("codes")
    .select("id, name")
    .eq("project_id", suggestion.project_id);
  for (const ec of existingCodes ?? []) {
    codeIdByName.set(ec.name.toLowerCase(), ec.id);
  }

  const codesToInsert = codes.filter((c) => !codeIdByName.has(c.name.toLowerCase()));
  if (codesToInsert.length > 0) {
    const { data: inserted, error: cErr } = await supabase
      .from("codes")
      .insert(
        codesToInsert.map((c) => ({
          user_id: userId,
          project_id: suggestion.project_id,
          name: c.name,
          description: c.description ?? null,
          color: c.color ?? randomCodeColor(c.name),
          created_by_ai: true,
        }))
      )
      .select("id, name");
    if (cErr) return errorResponse(`Failed to insert codes: ${cErr.message}`, 500);
    for (const row of inserted ?? []) codeIdByName.set(row.name.toLowerCase(), row.id);
  }

  // 2. Embed quotation contents in batches.
  let embeddings: number[][] = [];
  if (quotations.length > 0) {
    const BATCH = 32;
    for (let i = 0; i < quotations.length; i += BATCH) {
      const batch = quotations.slice(i, i + BATCH).map((q) => q.content);
      const { embeddings: vecs } = await embedTexts(batch, { inputType: "document" });
      embeddings = embeddings.concat(vecs);
    }
  }

  // 3. Insert quotations
  const quoteRows = quotations.map((q, i) => ({
    user_id: userId,
    project_id: suggestion.project_id,
    document_id: suggestion.document_id!,
    start_offset: q.start_offset,
    end_offset: q.end_offset,
    content: q.content,
    comment: q.rationale ?? null,
    embedding: embeddings[i] ?? null,
    created_by_ai: true,
  }));

  let quotationIds: string[] = [];
  if (quoteRows.length > 0) {
    const { data: insQuotes, error: qErr } = await supabase
      .from("quotations")
      .insert(quoteRows)
      .select("id");
    if (qErr) return errorResponse(`Failed to insert quotations: ${qErr.message}`, 500);
    quotationIds = (insQuotes ?? []).map((r) => r.id);
  }

  // 4. Insert quotation_codes
  const codingRows: {
    quotation_id: string;
    code_id: string;
    user_id: string;
    created_by_ai: boolean;
    ai_confidence: number | null;
  }[] = [];

  for (let i = 0; i < quotations.length; i++) {
    const qid = quotationIds[i];
    if (!qid) continue;
    for (const codeName of quotations[i].code_names) {
      const codeId = codeIdByName.get(codeName.toLowerCase());
      if (!codeId) continue;
      codingRows.push({
        quotation_id: qid,
        code_id: codeId,
        user_id: userId,
        created_by_ai: true,
        ai_confidence: quotations[i].confidence ?? null,
      });
    }
  }

  if (codingRows.length > 0) {
    const { error: cdErr } = await supabase.from("quotation_codes").insert(codingRows);
    if (cdErr) return errorResponse(`Failed to insert codings: ${cdErr.message}`, 500);
  }

  await supabase
    .from("ai_suggestions")
    .update({ status: "applied", reviewed_at: new Date().toISOString() })
    .eq("id", suggestionId);

  return jsonResponse({
    ok: true,
    insertedCodes: codesToInsert.length,
    insertedQuotations: quotationIds.length,
    insertedCodings: codingRows.length,
  });
});

function randomCodeColor(seed: string): string {
  // Deterministic palette so the same code name gets the same color.
  const palette = [
    "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
    "#EC4899", "#14B8A6", "#8B5CF6", "#6366F1", "#F97316",
    "#84CC16", "#06B6D4",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
