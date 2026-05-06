// Edge Function: import-project
// Accepts a .qdpx file (multipart form-data), parses the REFI-QDA XML and
// materialises a new PHDBuddy project with all codes, documents, quotations
// and memos. Uses the service role so it can bulk-insert without fighting RLS.
//
// The new project gets the caller as owner (via the add_project_owner trigger
// created in the F5 migration).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { parseQdpx } from "../_shared/exporters/qdaxml.ts";

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

  // Parse multipart body — the client sends { file: <qdpx blob> }.
  let fileBytes: Uint8Array;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return errorResponse("No file in form-data (field name: 'file')", 400);
    const allowed = ["application/zip", "application/octet-stream", "application/x-zip-compressed"];
    if (!allowed.includes(file.type) && !file.name.endsWith(".qdpx")) {
      return errorResponse("File must be a .qdpx archive", 400);
    }
    fileBytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    return errorResponse(`Failed to read file: ${err instanceof Error ? err.message : "unknown"}`, 400);
  }

  // Parse the archive.
  let parsed;
  try {
    parsed = await parseQdpx(fileBytes);
  } catch (err) {
    return errorResponse(`Failed to parse .qdpx: ${err instanceof Error ? err.message : "unknown"}`, 422);
  }

  const supabase = getServiceClient();

  // --- Create the project ---
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: parsed.name || "Imported project",
    })
    .select()
    .single();

  if (projErr || !project) {
    return errorResponse(`Failed to create project: ${projErr?.message ?? "unknown"}`, 500);
  }
  const projectId: string = project.id;

  // The add_project_owner trigger fires here and inserts the owner row
  // in project_members automatically.

  // --- Import codes (topological insertion: parent must exist first) ---
  // Map from QDE guid → PHDBuddy uuid.
  const codeGuidMap = new Map<string, string>();
  const colorFallback = "#7C3AED";

  // Iteratively insert codes whose parent is already known (or which have
  // no parent). Repeat until nothing changes — handles arbitrary depth and
  // is robust against cycles or dangling parentGuid refs (those get
  // re-parented to null on the final pass).
  const remaining = [...parsed.codes];
  const validGuids = new Set(parsed.codes.map((c) => c.guid));
  let safety = remaining.length + 5;
  while (remaining.length > 0 && safety-- > 0) {
    const next: typeof remaining = [];
    let progressed = false;
    for (const code of remaining) {
      const parentResolvable =
        !code.parentGuid ||
        codeGuidMap.has(code.parentGuid) ||
        !validGuids.has(code.parentGuid); // dangling → treat as root
      if (!parentResolvable) {
        next.push(code);
        continue;
      }
      const parentId = code.parentGuid ? (codeGuidMap.get(code.parentGuid) ?? null) : null;
      const { data: inserted, error } = await supabase
        .from("codes")
        .insert({
          user_id: userId,
          project_id: projectId,
          name: code.name || "Unnamed code",
          description: code.description || null,
          color: code.color ? `#${code.color.replace("#", "").padEnd(6, "0").slice(0, 6)}` : colorFallback,
          parent_id: parentId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        console.warn(`[import] failed to insert code ${code.name}: ${error?.message}`);
        progressed = true; // drop it from the queue regardless
        continue;
      }
      codeGuidMap.set(code.guid, inserted.id);
      progressed = true;
    }
    remaining.length = 0;
    remaining.push(...next);
    if (!progressed) break; // cycle — bail rather than loop forever
  }
  // Anything still remaining is part of a cycle; insert as roots.
  for (const code of remaining) {
    const { data: inserted } = await supabase
      .from("codes")
      .insert({
        user_id: userId,
        project_id: projectId,
        name: code.name || "Unnamed code",
        description: code.description || null,
        color: code.color ? `#${code.color.replace("#", "").padEnd(6, "0").slice(0, 6)}` : colorFallback,
        parent_id: null,
      })
      .select("id")
      .single();
    if (inserted) codeGuidMap.set(code.guid, inserted.id);
  }

  // --- Import documents + quotations ---
  const sourceGuidMap = new Map<string, string>(); // qde guid → doc id
  let importedDocs = 0;
  let importedQuotations = 0;
  let importedCodings = 0;

  for (const source of parsed.sources) {
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        project_id: projectId,
        title: source.name || "Unnamed source",
        kind: "other",
        full_text: source.text || null,
        status: source.text ? "ready" : "pending",
      })
      .select("id")
      .single();

    if (docErr || !doc) {
      console.warn(`[import] failed to insert doc ${source.name}: ${docErr?.message}`);
      continue;
    }
    sourceGuidMap.set(source.guid, doc.id);
    importedDocs++;
  }

  // Gather selections for all sources.
  for (const sel of parsed.selections) {
    const documentId = sourceGuidMap.get(sel.sourceGuid);
    if (!documentId) continue;

    if (sel.end <= sel.start) continue; // skip malformed offsets

    const content = (() => {
      const src = parsed.sources.find((s) => s.guid === sel.sourceGuid);
      if (!src?.text) return "";
      return src.text.slice(sel.start, sel.end);
    })();

    const { data: quote, error: quoteErr } = await supabase
      .from("quotations")
      .insert({
        user_id: userId,
        project_id: projectId,
        document_id: documentId,
        start_offset: sel.start,
        end_offset: sel.end,
        content: content || sel.comment || "(no text)",
        comment: sel.comment || null,
      })
      .select("id")
      .single();

    if (quoteErr || !quote) {
      console.warn(`[import] failed to insert quotation: ${quoteErr?.message}`);
      continue;
    }
    importedQuotations++;

    // Codings
    for (const codeGuid of sel.codeGuids) {
      const codeId = codeGuidMap.get(codeGuid);
      if (!codeId) continue;
      const { error: codingErr } = await supabase
        .from("quotation_codes")
        .insert({ quotation_id: quote.id, code_id: codeId, user_id: userId });
      if (!codingErr) importedCodings++;
    }
  }

  // --- Import memos ---
  let importedMemos = 0;
  for (const memo of parsed.memos) {
    const { error: memoErr } = await supabase
      .from("memos")
      .insert({
        user_id: userId,
        project_id: projectId,
        title: memo.name || "Untitled memo",
        content: memo.text || "",
        kind: "analytic",
      });
    if (!memoErr) importedMemos++;
  }

  return jsonResponse({
    ok: true,
    projectId,
    projectName: project.name,
    imported: {
      codes: codeGuidMap.size,
      documents: importedDocs,
      quotations: importedQuotations,
      codings: importedCodings,
      memos: importedMemos,
    },
  });
});
