// Edge Function: export-project
// Gathers all project data and serialises it to the requested format.
// Uploads the result to the 'exports' storage bucket and returns a
// 24-hour signed URL so the client can trigger a direct download.
//
// Supported formats: csv | markdown | qdaxml
// Synchronous generation is fine for typical qualitative projects
// (< 5 000 quotations). For larger datasets the client polls export_jobs.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { buildCsv, type CsvRow } from "../_shared/exporters/csv.ts";
import { buildMarkdown, type MarkdownExportInput } from "../_shared/exporters/markdown.ts";
import { buildQdpx, type QdaXmlInput } from "../_shared/exporters/qdaxml.ts";

type ExportFormat = "csv" | "markdown" | "qdaxml";

interface RequestBody {
  projectId: string;
  format: ExportFormat;
}

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24; // 24 h

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

  const { projectId, format } = body;
  if (!projectId) return errorResponse("Missing projectId", 400);
  if (!["csv", "markdown", "qdaxml"].includes(format)) {
    return errorResponse("Invalid format. Use: csv | markdown | qdaxml", 400);
  }

  const supabase = getServiceClient();

  // Authorization — caller must be a project member.
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return errorResponse("Not a project member", 403);
  }

  // --- Insert job row (status=pending) ---
  const { data: job, error: jobErr } = await supabase
    .from("export_jobs")
    .insert({
      project_id: projectId,
      user_id: userId,
      format,
      status: "pending",
    })
    .select()
    .single();

  if (jobErr || !job) {
    return errorResponse(`Failed to create export job: ${jobErr?.message ?? "unknown"}`, 500);
  }

  try {
    // --- Gather project-scoped tables (have project_id column) ---
    const [
      { data: project },
      { data: documents },
      { data: codes },
      { data: codeGroups },
      { data: quotationsRaw },
      { data: memos },
      { data: sentiments },
    ] = await Promise.all([
      supabase.from("projects").select("name,research_question,methodology").eq("id", projectId).single(),
      supabase.from("documents").select("id,title,kind,full_text").eq("project_id", projectId),
      supabase.from("codes").select("id,name,description,color,parent_id,usage_count").eq("project_id", projectId),
      supabase.from("code_groups").select("id,name,description").eq("project_id", projectId),
      supabase.from("quotations").select("id,document_id,start_offset,end_offset,content,comment,created_at").eq("project_id", projectId),
      supabase.from("memos").select("id,title,kind,content").eq("project_id", projectId),
      supabase.from("quotation_sentiment").select("quotation_id,label").eq("project_id", projectId),
    ]);

    if (!project) throw new Error("Project not found");
    const docs = documents ?? [];
    const codeList = codes ?? [];
    const quotas = quotationsRaw ?? [];
    const memoList = memos ?? [];

    // --- Junction tables (no project_id column) — must scope by parent IDs.
    // Service-role bypasses RLS so we MUST filter explicitly to avoid
    // leaking other projects' rows into the export.
    const quotationIds = quotas.map((q: { id: string }) => q.id);
    const codeGroupIds = (codeGroups ?? []).map((g: { id: string }) => g.id);

    const [{ data: quotationCodes }, { data: codeGroupMembers }] = await Promise.all([
      quotationIds.length > 0
        ? supabase
            .from("quotation_codes")
            .select("quotation_id,code_id,created_by_ai")
            .in("quotation_id", quotationIds)
        : Promise.resolve({ data: [] as Array<{ quotation_id: string; code_id: string; created_by_ai: boolean }> }),
      codeGroupIds.length > 0
        ? supabase
            .from("code_group_members")
            .select("code_id,code_group_id")
            .in("code_group_id", codeGroupIds)
        : Promise.resolve({ data: [] as Array<{ code_id: string; code_group_id: string }> }),
    ]);

    const qcList = quotationCodes ?? [];
    const sentimentMap = new Map((sentiments ?? []).map((s: { quotation_id: string; label: string }) => [s.quotation_id, s.label]));
    const codeNameMap = new Map(codeList.map((c: { id: string; name: string }) => [c.id, c.name]));

    // Build code-list per quotation
    const quotationCodeMap = new Map<string, Array<{ code_id: string; created_by_ai: boolean }>>();
    for (const qc of qcList) {
      const arr = quotationCodeMap.get(qc.quotation_id) ?? [];
      arr.push({ code_id: qc.code_id, created_by_ai: qc.created_by_ai });
      quotationCodeMap.set(qc.quotation_id, arr);
    }

    const docMap = new Map(docs.map((d: { id: string; title: string }) => [d.id, d]));

    // --- Build the export file ---
    let fileBytes: Uint8Array;
    let contentType: string;
    let extension: string;

    if (format === "csv") {
      const rows: CsvRow[] = quotas.map((q: { id: string; document_id: string; content: string; comment: string | null; created_at: string }) => {
        const doc = docMap.get(q.document_id);
        const codenames = (quotationCodeMap.get(q.id) ?? [])
          .map((c) => codeNameMap.get(c.code_id) ?? "")
          .filter(Boolean)
          .join(", ");
        return {
          quotation_id: q.id,
          document_title: doc?.title ?? "",
          document_kind: (doc as { kind?: string } | undefined)?.kind ?? "",
          content: q.content,
          codes: codenames,
          comment: q.comment ?? "",
          sentiment_label: sentimentMap.get(q.id) ?? "",
          created_at: q.created_at,
        };
      });
      fileBytes = buildCsv(rows);
      contentType = "text/csv";
      extension = "csv";

    } else if (format === "markdown") {
      const input: MarkdownExportInput = {
        project,
        codes: codeList,
        codeGroups: codeGroups ?? [],
        codeGroupMembers: codeGroupMembers ?? [],
        quotations: quotas.map((q: { id: string; document_id: string; content: string; comment: string | null }) => ({
          id: q.id,
          document_title: docMap.get(q.document_id)?.title ?? "",
          content: q.content,
          comment: q.comment,
          codes: (quotationCodeMap.get(q.id) ?? []).map((c) => c.code_id),
          sentiment_label: sentimentMap.get(q.id) ?? null,
        })),
        memos: memoList,
      };
      fileBytes = buildMarkdown(input);
      contentType = "text/markdown";
      extension = "md";

    } else {
      // qdaxml
      const input: QdaXmlInput = {
        project,
        documents: docs.map((d: { id: string; title: string; kind: string; full_text: string | null }) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          full_text: d.full_text,
        })),
        codes: codeList,
        quotations: quotas.map((q: { id: string; document_id: string; start_offset: number; end_offset: number; content: string; comment: string | null }) => ({
          id: q.id,
          document_id: q.document_id,
          start_offset: q.start_offset,
          end_offset: q.end_offset,
          content: q.content,
          comment: q.comment,
          codes: (quotationCodeMap.get(q.id) ?? []).map((c) => ({
            code_id: c.code_id,
            created_by_ai: c.created_by_ai,
          })),
        })),
        memos: memoList,
      };
      fileBytes = buildQdpx(input);
      contentType = "application/zip";
      extension = "qdpx";
    }

    // --- Upload to storage ---
    const ts = new Date().toISOString().replace(/[:\.]/g, "-");
    const storagePath = `${projectId}/${ts}.${extension}`;

    const { error: uploadErr } = await supabase.storage
      .from("exports")
      .upload(storagePath, fileBytes, {
        contentType,
        upsert: false,
      });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // --- Generate signed URL (24 h) ---
    const { data: urlData, error: urlErr } = await supabase.storage
      .from("exports")
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

    if (urlErr || !urlData?.signedUrl) throw new Error(`Failed to generate signed URL: ${urlErr?.message ?? "unknown"}`);

    const signedUrl = urlData.signedUrl;
    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

    // --- Update job row ---
    await supabase.from("export_jobs").update({
      status: "done",
      storage_path: storagePath,
      signed_url: signedUrl,
      signed_url_expires_at: expiresAt,
    }).eq("id", job.id);

    return jsonResponse({
      ok: true,
      jobId: job.id,
      format,
      signedUrl,
      expiresAt,
      storagePath,
      sizeBytes: fileBytes.length,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Export failed";
    await supabase.from("export_jobs").update({
      status: "error",
      error_message: msg,
    }).eq("id", job.id);
    return errorResponse(msg, 500);
  }
});
