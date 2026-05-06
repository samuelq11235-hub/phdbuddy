// Edge Function: execute-query
// Evaluates a boolean AST over project quotations and returns the matching
// quotation IDs (capped to a reasonable number).
//
// AST node shapes:
//   { op: 'and'|'or', children: QueryNode[] }
//   { op: 'not', child: QueryNode }
//   { op: 'code', codeId: string }                  → quotations coded with that code
//   { op: 'document', documentId: string }          → quotations in that document
//   { op: 'sentiment', label: string }              → quotations with that sentiment label
//   { op: 'cooccurs', a: string, b: string }        → quotations coded with BOTH a AND b
//
// All evaluation happens in JS over a single materialised "candidate pool" =
// every quotation_id of the project. Each leaf produces a Set; operators
// combine them. This stays simple and fast for projects up to a few tens
// of thousands of quotations.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface QueryNode {
  op: string;
  children?: QueryNode[];
  child?: QueryNode;
  codeId?: string;
  documentId?: string;
  label?: string;
  a?: string;
  b?: string;
}

const RESULT_CAP = 5000;

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
  let query: QueryNode;
  try {
    const body = await req.json();
    projectId = body.projectId;
    query = body.query;
    if (!projectId || !query) return errorResponse("projectId and query required", 400);
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // Authorize via member check (bypasses any AST trickery).
  const { data: roleRow } = await userClient
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!roleRow) return errorResponse("Forbidden", 403);

  const supabase = getServiceClient();

  // Pre-fetch the project's quotations + sentiment first; that gives us
  // the project-scoped IDs needed to safely query quotation_codes.
  const [{ data: allQuotaRows }, { data: sentimentRows }] = await Promise.all([
    supabase.from("quotations").select("id, document_id").eq("project_id", projectId),
    supabase.from("quotation_sentiment").select("quotation_id, label").eq("project_id", projectId),
  ]);

  const all = (allQuotaRows ?? []) as Array<{ id: string; document_id: string }>;
  const allSet = new Set(all.map((q) => q.id));
  const docIndex = new Map<string, Set<string>>();
  for (const q of all) {
    let s = docIndex.get(q.document_id);
    if (!s) { s = new Set(); docIndex.set(q.document_id, s); }
    s.add(q.id);
  }

  // quotation_codes has no project_id column. With service-role we'd
  // otherwise scan the whole DB; filter explicitly by this project's
  // quotations instead. (Same fix as in export-project.)
  const codeIndex = new Map<string, Set<string>>();
  if (all.length > 0) {
    const quotationIds = all.map((q) => q.id);
    // PostgREST .in() uses a query string, which has a length limit
    // (~16 KiB on Supabase). Chunk to stay well under that for huge
    // projects (a UUID is 36 chars; ~400 IDs ≈ 14 KiB worst case).
    const CHUNK = 400;
    for (let i = 0; i < quotationIds.length; i += CHUNK) {
      const slice = quotationIds.slice(i, i + CHUNK);
      const { data: qcRows } = await supabase
        .from("quotation_codes")
        .select("quotation_id, code_id")
        .in("quotation_id", slice);
      for (const qc of (qcRows ?? []) as Array<{ quotation_id: string; code_id: string }>) {
        if (!allSet.has(qc.quotation_id)) continue;
        let s = codeIndex.get(qc.code_id);
        if (!s) { s = new Set(); codeIndex.set(qc.code_id, s); }
        s.add(qc.quotation_id);
      }
    }
  }
  const sentimentIndex = new Map<string, Set<string>>();
  for (const r of (sentimentRows ?? []) as Array<{ quotation_id: string; label: string }>) {
    let s = sentimentIndex.get(r.label);
    if (!s) { s = new Set(); sentimentIndex.set(r.label, s); }
    s.add(r.quotation_id);
  }

  function evalNode(node: QueryNode): Set<string> {
    switch (node.op) {
      case "code":
        return node.codeId ? (codeIndex.get(node.codeId) ?? new Set()) : new Set();
      case "document":
        return node.documentId ? (docIndex.get(node.documentId) ?? new Set()) : new Set();
      case "sentiment":
        return node.label ? (sentimentIndex.get(node.label) ?? new Set()) : new Set();
      case "cooccurs": {
        if (!node.a || !node.b) return new Set();
        const A = codeIndex.get(node.a) ?? new Set();
        const B = codeIndex.get(node.b) ?? new Set();
        return intersect(A, B);
      }
      case "not": {
        if (!node.child) return allSet;
        return difference(allSet, evalNode(node.child));
      }
      case "and": {
        if (!node.children || node.children.length === 0) return new Set();
        let acc: Set<string> | null = null;
        for (const c of node.children) {
          const s = evalNode(c);
          acc = acc === null ? new Set(s) : intersect(acc, s);
          if (acc.size === 0) return acc; // short-circuit
        }
        return acc ?? new Set();
      }
      case "or": {
        const out = new Set<string>();
        for (const c of node.children ?? []) {
          for (const id of evalNode(c)) out.add(id);
        }
        return out;
      }
      default:
        return new Set();
    }
  }

  const matches = evalNode(query);
  const ids = Array.from(matches).slice(0, RESULT_CAP);

  return jsonResponse({
    ok: true,
    quotationIds: ids,
    total: matches.size,
    capped: matches.size > RESULT_CAP,
  });
});

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) out.add(x);
  return out;
}

function difference(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (!b.has(x)) out.add(x);
  return out;
}
