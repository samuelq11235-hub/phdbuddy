// Edge Function: reproducibility-report
//
// Produces a deterministic snapshot of the project that a researcher
// can attach to a thesis appendix or a journal submission to prove the
// analysis is reproducible. The report covers everything a reviewer
// needs to verify the work:
//
//   - Project metadata, research question, methodology
//   - Active theoretical framework (with citation)
//   - Frozen codebook (id, name, parent, usage_count, description)
//   - Document inventory with word counts and source kinds
//   - SHA-256 hash of the concatenated corpus (sorted by id)
//   - Decision log (last N activity_log rows)
//   - Inter-coder agreement metrics if available
//   - Generation timestamp + user id
//
// Body: { projectId: string }
// Returns: { ok, report: <ReproducibilityReport> }
//
// The report is JSON. Rendering as HTML is the client's job; that lets
// the same payload power both a downloadable HTML file and an
// in-browser preview.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface RequestBody {
  projectId: string;
}

interface CodeSnapshot {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  usage_count: number;
  color: string;
  created_at: string;
}

interface DocumentSnapshot {
  id: string;
  title: string;
  kind: string | null;
  word_count: number;
  page_count: number | null;
  created_at: string;
}

interface ActivitySnapshot {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AgreementSnapshot {
  coderA: string;
  coderB: string;
  cohenK: number;
  agreement: number;
  computedAt: string;
}

interface ReproducibilityReport {
  generatedAt: string;
  generatedByUserId: string;
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    description: string | null;
    research_question: string | null;
    methodology: string | null;
    color: string;
    created_at: string;
    updated_at: string;
  };
  framework: {
    name: string;
    slug: string;
    citation: string | null;
    prompt_addendum: string;
  } | null;
  corpus: {
    documentCount: number;
    totalWords: number;
    sha256: string;
    documents: DocumentSnapshot[];
  };
  codebook: {
    codeCount: number;
    rootCount: number;
    leafCount: number;
    codes: CodeSnapshot[];
  };
  attributeSchema: {
    name: string;
    data_type: string;
    options: string[] | null;
  }[];
  decisions: ActivitySnapshot[];
  agreement: AgreementSnapshot[];
  caveats: string[];
}

const ACTIVITY_LIMIT = 200;

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
  if (!body.projectId) return errorResponse("Missing projectId", 400);

  const supabase = getServiceClient();
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", body.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return errorResponse("Forbidden", 403);

  // Pull every section in parallel. Some tables may not exist on all
  // deployments (agreement / activity_log) — we tolerate empty results.
  const [
    projectRes,
    codesRes,
    docsRes,
    schemaRes,
    activityRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, description, research_question, methodology, color, created_at, updated_at, theory_framework_id"
      )
      .eq("id", body.projectId)
      .maybeSingle(),
    supabase
      .from("codes")
      .select("id, name, description, parent_id, usage_count, color, created_at")
      .eq("project_id", body.projectId)
      .order("name", { ascending: true }),
    supabase
      .from("documents")
      .select("id, title, kind, full_text, word_count, page_count, created_at")
      .eq("project_id", body.projectId)
      .order("id", { ascending: true }),
    supabase
      .from("document_attribute_schema")
      .select("name, data_type, options")
      .eq("project_id", body.projectId),
    supabase
      .from("activity_log")
      .select("id, action, entity_type, entity_id, actor_id, metadata, created_at")
      .eq("project_id", body.projectId)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ]);

  const project = projectRes.data;
  if (!project) return errorResponse("Project not found", 404);

  // Resolve the framework (if any).
  let framework: ReproducibilityReport["framework"] = null;
  if (project.theory_framework_id) {
    const { data: fw } = await supabase
      .from("theory_frameworks")
      .select("name, slug, citation, prompt_addendum")
      .eq("id", project.theory_framework_id)
      .maybeSingle();
    if (fw) {
      framework = {
        name: fw.name as string,
        slug: fw.slug as string,
        citation: (fw.citation as string | null) ?? null,
        prompt_addendum: fw.prompt_addendum as string,
      };
    }
  }

  // Compute the SHA-256 hash of the corpus. We sort by id (already done
  // in the query) and concatenate full_text fields with a delimiter so
  // the hash is deterministic across runs that share the same corpus.
  const docsRaw = (docsRes.data ?? []) as {
    id: string;
    title: string;
    kind: string | null;
    full_text: string | null;
    word_count: number | null;
    page_count: number | null;
    created_at: string;
  }[];

  const concatenated = docsRaw
    .map((d) => `${d.id}|${(d.full_text ?? "").length}|${d.full_text ?? ""}`)
    .join("\u0001");
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(concatenated)
  );
  const sha256 = bufferToHex(hashBuffer);

  const documents: DocumentSnapshot[] = docsRaw.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    word_count: d.word_count ?? wordCount(d.full_text ?? ""),
    page_count: d.page_count,
    created_at: d.created_at,
  }));
  const totalWords = documents.reduce((s, d) => s + (d.word_count ?? 0), 0);

  const codes = ((codesRes.data ?? []) as CodeSnapshot[]).map((c) => ({
    ...c,
  }));
  const rootCount = codes.filter((c) => !c.parent_id).length;
  const leafCount = codes.filter(
    (c) => !codes.some((other) => other.parent_id === c.id)
  ).length;

  const decisions: ActivitySnapshot[] = (
    (activityRes.data ?? []) as ActivitySnapshot[]
  ).map((a) => ({ ...a }));

  // Agreement metrics aren't persisted yet in this project — we leave
  // the array empty and surface a caveat below. Future versions can
  // store agreement runs in a dedicated table and pull them here.
  const agreement: AgreementSnapshot[] = [];

  const caveats: string[] = [];
  if (codes.length === 0) caveats.push("El proyecto no tiene códigos.");
  if (totalWords < 10_000)
    caveats.push("Corpus pequeño (<10K palabras): la saturación no es comparable a estudios mayores.");
  if (decisions.length === 0)
    caveats.push("No hay registro de decisiones; activity_log está vacío.");
  if (agreement.length === 0)
    caveats.push("No se ha computado acuerdo intercodificadores en este proyecto.");

  const report: ReproducibilityReport = {
    generatedAt: new Date().toISOString(),
    generatedByUserId: userId,
    schemaVersion: 1,
    project: {
      id: project.id as string,
      name: project.name as string,
      description: (project.description as string | null) ?? null,
      research_question: (project.research_question as string | null) ?? null,
      methodology: (project.methodology as string | null) ?? null,
      color: (project.color as string) ?? "#6366f1",
      created_at: project.created_at as string,
      updated_at: project.updated_at as string,
    },
    framework,
    corpus: {
      documentCount: documents.length,
      totalWords,
      sha256,
      documents,
    },
    codebook: {
      codeCount: codes.length,
      rootCount,
      leafCount,
      codes,
    },
    attributeSchema: ((schemaRes.data ?? []) as {
      name: string;
      data_type: string;
      options: string[] | null;
    }[]).map((s) => ({
      name: s.name,
      data_type: s.data_type,
      options: s.options ?? null,
    })),
    decisions,
    agreement,
    caveats,
  };

  return jsonResponse({ ok: true, report });
});

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}
