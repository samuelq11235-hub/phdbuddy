// Edge Function: compute-agreement
// Inter-coder agreement metrics for two project members on the same set
// of documents. Computes Cohen's kappa per code and a global Krippendorff
// alpha (nominal level), plus simple percent agreement.
//
// Unit of analysis: each (document, code, character-position-bucket).
// We bucket text into a fixed number of positions per document (default
// 100 buckets) and ask, for each (code, bucket), whether each coder
// applied that code in that bucket. That gives a presence/absence label
// per coder which is the standard reliability primitive in CAQDAS tools.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

const BUCKETS_PER_DOCUMENT = 100;

interface QcRow {
  quotation_id: string;
  code_id: string;
  user_id: string;
}
interface QuotationRow {
  id: string;
  document_id: string;
  start_offset: number;
  end_offset: number;
}
interface DocumentRow {
  id: string;
  full_text: string | null;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let userId: string;
  let userClient;
  try {
    ({ userId, client: userClient } = await getUserFromRequest(req));
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unauthorized", 401);
  }

  let projectId: string;
  let userA: string;
  let userB: string;
  let documentIds: string[] | null = null;
  try {
    const body = await req.json();
    projectId = body.projectId;
    userA = body.userA;
    userB = body.userB;
    documentIds = Array.isArray(body.documentIds) ? body.documentIds : null;
    if (!projectId || !userA || !userB) {
      return errorResponse("projectId, userA, userB are required", 400);
    }
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // Authorize: caller must be project member.
  const { data: roleRow, error: roleErr } = await userClient
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (roleErr || !roleRow) {
    return errorResponse("Forbidden: not a member of this project", 403);
  }

  // Use service role to gather data (RLS-bypass for cross-user reads).
  const supabase = getServiceClient();

  // Documents in scope.
  let docQuery = supabase
    .from("documents")
    .select("id, full_text")
    .eq("project_id", projectId);
  if (documentIds && documentIds.length > 0) {
    docQuery = docQuery.in("id", documentIds);
  }
  const { data: docs, error: docErr } = await docQuery;
  if (docErr) return errorResponse(docErr.message, 500);
  const documents = (docs ?? []) as DocumentRow[];
  if (documents.length === 0) {
    return jsonResponse({
      ok: true,
      perCode: [],
      global: { alpha: null, simpleAgreement: null, n: 0, kappa: null },
      discrepancies: [],
    });
  }
  const docIds = documents.map((d) => d.id);
  const docLengthMap = new Map(
    documents.map((d) => [d.id, Math.max(1, (d.full_text ?? "").length)])
  );

  // Quotations in scope. Multimedia citations have null offsets — they
  // can't be placed into character buckets, so the κ/α math excludes
  // them up front. Inter-coder agreement on time-range / image-area
  // citations is a separate problem (different unit of analysis) we'd
  // need a dedicated metric for.
  const { data: quotaRows, error: qErr } = await supabase
    .from("quotations")
    .select("id, document_id, start_offset, end_offset")
    .eq("project_id", projectId)
    .in("document_id", docIds)
    .not("start_offset", "is", null)
    .not("end_offset", "is", null);
  if (qErr) return errorResponse(qErr.message, 500);
  const quotations = (quotaRows ?? []) as QuotationRow[];
  const quotaMap = new Map(quotations.map((q) => [q.id, q]));
  const quotationIds = quotations.map((q) => q.id);

  if (quotationIds.length === 0) {
    return jsonResponse({
      ok: true,
      perCode: [],
      global: { alpha: null, simpleAgreement: null, n: 0, kappa: null },
      discrepancies: [],
    });
  }

  // Codings by either of the two users.
  const { data: qcRows, error: qcErr } = await supabase
    .from("quotation_codes")
    .select("quotation_id, code_id, user_id")
    .in("quotation_id", quotationIds)
    .in("user_id", [userA, userB]);
  if (qcErr) return errorResponse(qcErr.message, 500);
  const codings = (qcRows ?? []) as QcRow[];

  // Code names for the response.
  const allCodeIds = Array.from(new Set(codings.map((c) => c.code_id)));
  const { data: codeRows } = await supabase
    .from("codes")
    .select("id, name")
    .in("id", allCodeIds.length > 0 ? allCodeIds : ["00000000-0000-0000-0000-000000000000"]);
  const codeNameMap = new Map((codeRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  // Build per-(coder, code, document, bucket) presence sets.
  // bucketKey = `${docId}|${bucketIndex}` to keep it cheap.
  function bucketsForQuotation(q: QuotationRow): number[] {
    if (q.start_offset == null || q.end_offset == null) return [];
    const len = docLengthMap.get(q.document_id) ?? 1;
    const startBucket = Math.max(
      0,
      Math.min(BUCKETS_PER_DOCUMENT - 1, Math.floor((q.start_offset / len) * BUCKETS_PER_DOCUMENT))
    );
    const endBucket = Math.max(
      0,
      Math.min(BUCKETS_PER_DOCUMENT - 1, Math.floor((q.end_offset / len) * BUCKETS_PER_DOCUMENT))
    );
    const out: number[] = [];
    for (let i = startBucket; i <= endBucket; i++) out.push(i);
    return out;
  }

  // Map<codeId, Map<bucketKey, Set<userId>>>
  const presence = new Map<string, Map<string, Set<string>>>();

  for (const qc of codings) {
    const q = quotaMap.get(qc.quotation_id);
    if (!q) continue;
    const buckets = bucketsForQuotation(q);
    let codeMap = presence.get(qc.code_id);
    if (!codeMap) {
      codeMap = new Map();
      presence.set(qc.code_id, codeMap);
    }
    for (const b of buckets) {
      const key = `${q.document_id}|${b}`;
      let set = codeMap.get(key);
      if (!set) {
        set = new Set();
        codeMap.set(key, set);
      }
      set.add(qc.user_id);
    }
  }

  // For each code, for each bucket across all documents, compute the
  // 2x2 contingency table: A=present, B=present, A=absent etc.
  const totalBuckets = docIds.length * BUCKETS_PER_DOCUMENT;

  type CodeMetric = {
    code_id: string;
    code_name: string;
    a_only: number;
    b_only: number;
    both: number;
    neither: number;
    kappa: number | null;
    percentAgreement: number;
  };
  const perCode: CodeMetric[] = [];

  for (const codeId of presence.keys()) {
    const codeMap = presence.get(codeId) ?? new Map();
    let both = 0;
    let aOnly = 0;
    let bOnly = 0;
    for (const set of codeMap.values()) {
      const hasA = set.has(userA);
      const hasB = set.has(userB);
      if (hasA && hasB) both++;
      else if (hasA) aOnly++;
      else if (hasB) bOnly++;
    }
    const neither = totalBuckets - both - aOnly - bOnly;

    const n = totalBuckets;
    const po = (both + neither) / n;
    const pa = (both + aOnly) / n;
    const pb = (both + bOnly) / n;
    const pe = pa * pb + (1 - pa) * (1 - pb);
    const kappa = pe < 1 ? (po - pe) / (1 - pe) : null;

    perCode.push({
      code_id: codeId,
      code_name: codeNameMap.get(codeId) ?? "(deleted)",
      a_only: aOnly,
      b_only: bOnly,
      both,
      neither,
      kappa,
      percentAgreement: po,
    });
  }
  perCode.sort((a, b) => (b.both + b.a_only + b.b_only) - (a.both + a.a_only + a.b_only));

  // -----------------------------------------------------
  // Global Krippendorff's alpha (nominal level, 2 coders).
  // For nominal alpha with 2 coders, alpha = (n*Po - Pe) / (n*(1 - Pe))
  // approximately reduces to Cohen's kappa when n is large. We compute
  // alpha properly using the formula:
  //   alpha = 1 - (Do / De)
  // where Do = observed disagreement, De = expected disagreement.
  // Each unit (document × bucket) has a multiset of code labels per coder.
  // We treat the "label" per (coder, unit) as the SET of codes applied.
  // Two coders agree on a unit iff their code-set is identical.
  // -----------------------------------------------------
  // Build coder-set per unit.
  const unitLabels = new Map<string, { a: string; b: string }>();
  for (const docId of docIds) {
    for (let i = 0; i < BUCKETS_PER_DOCUMENT; i++) {
      const key = `${docId}|${i}`;
      unitLabels.set(key, { a: "", b: "" });
    }
  }
  // Collect per-bucket sets per user.
  const userBucketCodes = new Map<string, Map<string, Set<string>>>();
  for (const qc of codings) {
    const q = quotaMap.get(qc.quotation_id);
    if (!q) continue;
    for (const b of bucketsForQuotation(q)) {
      const key = `${q.document_id}|${b}`;
      let m = userBucketCodes.get(qc.user_id);
      if (!m) {
        m = new Map();
        userBucketCodes.set(qc.user_id, m);
      }
      let s = m.get(key);
      if (!s) {
        s = new Set();
        m.set(key, s);
      }
      s.add(qc.code_id);
    }
  }
  const aMap = userBucketCodes.get(userA) ?? new Map();
  const bMap = userBucketCodes.get(userB) ?? new Map();
  for (const key of unitLabels.keys()) {
    const aSet = aMap.get(key);
    const bSet = bMap.get(key);
    const aLabel = aSet ? Array.from(aSet).sort().join(",") : "";
    const bLabel = bSet ? Array.from(bSet).sort().join(",") : "";
    unitLabels.set(key, { a: aLabel, b: bLabel });
  }

  // Observed disagreement = fraction of units where labels differ.
  let differing = 0;
  const labelCounts = new Map<string, number>();
  for (const v of unitLabels.values()) {
    if (v.a !== v.b) differing++;
    labelCounts.set(v.a, (labelCounts.get(v.a) ?? 0) + 1);
    labelCounts.set(v.b, (labelCounts.get(v.b) ?? 0) + 1);
  }
  const Do = differing / unitLabels.size;

  // Expected disagreement under chance (nominal):
  // De = 1 - sum_c (n_c / N)^2 where n_c is total count of label c
  // across both coders and N = 2 * unit count.
  const N = 2 * unitLabels.size;
  let sumSq = 0;
  for (const c of labelCounts.values()) {
    sumSq += (c / N) * (c / N);
  }
  const De = 1 - sumSq;
  const alpha = De > 0 ? 1 - Do / De : null;

  // Simple agreement.
  const simpleAgreement = 1 - Do;

  // -----------------------------------------------------
  // Discrepancies: list quotations whose code set differs between A and B.
  // -----------------------------------------------------
  const codingsByQuotation = new Map<string, { a: Set<string>; b: Set<string> }>();
  for (const qc of codings) {
    let entry = codingsByQuotation.get(qc.quotation_id);
    if (!entry) {
      entry = { a: new Set(), b: new Set() };
      codingsByQuotation.set(qc.quotation_id, entry);
    }
    if (qc.user_id === userA) entry.a.add(qc.code_id);
    else if (qc.user_id === userB) entry.b.add(qc.code_id);
  }
  const discrepancies: Array<{
    quotation_id: string;
    a_codes: string[];
    b_codes: string[];
  }> = [];
  for (const [qid, entry] of codingsByQuotation.entries()) {
    const aArr = Array.from(entry.a).sort();
    const bArr = Array.from(entry.b).sort();
    if (aArr.join(",") !== bArr.join(",")) {
      discrepancies.push({
        quotation_id: qid,
        a_codes: aArr.map((id) => codeNameMap.get(id) ?? id),
        b_codes: bArr.map((id) => codeNameMap.get(id) ?? id),
      });
    }
  }

  return jsonResponse({
    ok: true,
    perCode,
    global: {
      alpha,
      simpleAgreement,
      kappa: perCode.length > 0
        ? perCode.reduce((s, c) => s + (c.kappa ?? 0), 0) / perCode.length
        : null,
      n: unitLabels.size,
      bucketsPerDocument: BUCKETS_PER_DOCUMENT,
    },
    discrepancies: discrepancies.slice(0, 200), // cap response size
  });
});
