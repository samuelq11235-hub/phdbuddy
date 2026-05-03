// Edge Function: embed-quotation
// Compute and persist a Voyage embedding for a single quotation.
// Called by the client after creating a quotation, so the quotation
// participates in semantic search, code suggestion, theme clustering and chat.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { embedTexts } from "../_shared/voyage.ts";

interface RequestBody {
  quotationId: string;
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

  const { quotationId } = body;
  if (!quotationId) return errorResponse("Missing quotationId", 400);

  const supabase = getServiceClient();

  const { data: quote, error } = await supabase
    .from("quotations")
    .select("id, user_id, content")
    .eq("id", quotationId)
    .eq("user_id", userId)
    .single();

  if (error || !quote) return errorResponse("Quotation not found", 404);
  if (!quote.content || quote.content.trim().length === 0) {
    return errorResponse("Quotation content is empty", 400);
  }

  try {
    const { embeddings } = await embedTexts([quote.content], { inputType: "document" });
    const vec = embeddings[0];
    if (!vec) return errorResponse("Failed to compute embedding", 500);

    const { error: upErr } = await supabase
      .from("quotations")
      .update({ embedding: vec })
      .eq("id", quotationId);
    if (upErr) return errorResponse(`Failed to save embedding: ${upErr.message}`, 500);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Embedding failed", 500);
  }
});
