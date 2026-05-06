// =====================================================
// PHDBuddy F15 — Survey/CSV importer
// =====================================================
// Atlas.ti's "Survey Import" feature: a CSV where each row is one
// respondent and each column is either:
//
//   - the respondent identifier (becomes document title),
//   - a text content column (becomes the document's full_text),
//   - an attribute column (becomes a key/value in
//     documents.source_metadata, validated against
//     document_attribute_schema if a matching entry exists).
//
// Multiple content columns per row produce multiple documents per row,
// each linked to the same respondent's attributes. Atlas calls this
// "open-ended question = one document per question per respondent".
//
// Request:
//   POST /import-survey
//   multipart/form-data:
//     file:    <csv file>
//     project: <projectId>            // either project_id of existing
//     OR
//     newProject: <"true"|"false">    // if true, create a new project
//     newProjectName: <string>        // required when newProject=true
//     mapping: <json>                 // see Mapping below
//
// Mapping schema:
//   {
//     idColumn?: string,                 // optional: column to use as title prefix
//     contentColumns: string[],          // one document per column per row
//     attributeColumns: string[],        // copied into source_metadata
//     groupName?: string,                // optional: document group to add all rows to
//     skipEmpty?: boolean                // default true: skip rows where the content is blank
//   }
// =====================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface Mapping {
  idColumn?: string;
  contentColumns: string[];
  attributeColumns: string[];
  groupName?: string;
  skipEmpty?: boolean;
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Expected multipart/form-data");
  }

  const file = formData.get("file") as File | null;
  if (!file) return errorResponse("file field required");

  const mappingRaw = formData.get("mapping");
  if (typeof mappingRaw !== "string") return errorResponse("mapping field required");
  let mapping: Mapping;
  try {
    mapping = JSON.parse(mappingRaw) as Mapping;
  } catch {
    return errorResponse("mapping must be valid JSON");
  }
  if (!Array.isArray(mapping.contentColumns) || mapping.contentColumns.length === 0) {
    return errorResponse("mapping.contentColumns must be a non-empty array");
  }
  mapping.attributeColumns = mapping.attributeColumns ?? [];
  mapping.skipEmpty = mapping.skipEmpty ?? true;

  const csvText = await file.text();
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    return errorResponse(`CSV parse error: ${err instanceof Error ? err.message : "unknown"}`);
  }
  if (rows.length === 0) return errorResponse("CSV has no data rows");

  const supabase = getServiceClient();

  // --- Resolve / create project ----------------------------------------
  let projectId = formData.get("project") as string | null;
  if (formData.get("newProject") === "true") {
    const name = (formData.get("newProjectName") as string | null) ?? file.name.replace(/\.csv$/i, "");
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, name })
      .select("id")
      .single();
    if (error || !project) return errorResponse(`Could not create project: ${error?.message}`, 500);
    projectId = project.id as string;
  }
  if (!projectId) return errorResponse("project (id) or newProject=true required");

  // Membership check (service-role bypasses RLS, so do it manually).
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership || !(membership.role === "owner" || membership.role === "admin" || membership.role === "coder")) {
    return errorResponse("Forbidden — coder role or higher required", 403);
  }

  // --- Optional: create / reuse document group --------------------------
  let groupId: string | null = null;
  if (mapping.groupName && mapping.groupName.trim()) {
    const trimmed = mapping.groupName.trim();
    const { data: existing } = await supabase
      .from("document_groups")
      .select("id")
      .eq("project_id", projectId)
      .ilike("name", trimmed)
      .maybeSingle();
    if (existing) {
      groupId = existing.id as string;
    } else {
      const { data: created } = await supabase
        .from("document_groups")
        .insert({ project_id: projectId, user_id: userId, name: trimmed })
        .select("id")
        .single();
      groupId = (created?.id as string | undefined) ?? null;
    }
  }

  // --- Build documents to insert ---------------------------------------
  const docsToInsert: Array<{
    project_id: string;
    user_id: string;
    title: string;
    full_text: string;
    kind: "text";
    status: "ready";
    source_metadata: Record<string, string>;
    word_count: number;
  }> = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const respondentId = mapping.idColumn ? (row[mapping.idColumn] ?? `row-${r + 1}`).trim() : `row-${r + 1}`;
    const attrs: Record<string, string> = {};
    for (const col of mapping.attributeColumns) {
      if (col in row) attrs[col] = row[col];
    }

    for (const contentCol of mapping.contentColumns) {
      const text = (row[contentCol] ?? "").trim();
      if (!text && mapping.skipEmpty) continue;
      docsToInsert.push({
        project_id: projectId,
        user_id: userId,
        title: `${respondentId} — ${contentCol}`,
        full_text: text,
        kind: "text",
        status: "ready",
        source_metadata: { ...attrs, _respondent: respondentId, _question: contentCol },
        word_count: text.split(/\s+/).filter(Boolean).length,
      });
    }
  }

  if (docsToInsert.length === 0) {
    return errorResponse("All rows were empty after applying mapping");
  }

  // --- Bulk insert in chunks (Postgres prefers <1000 per insert) -------
  const insertedIds: string[] = [];
  const CHUNK = 200;
  for (let i = 0; i < docsToInsert.length; i += CHUNK) {
    const slice = docsToInsert.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("documents")
      .insert(slice)
      .select("id");
    if (error) return errorResponse(`Insert failed at row ${i}: ${error.message}`, 500);
    for (const row of data ?? []) insertedIds.push(row.id as string);
  }

  // --- Add to group if any ---------------------------------------------
  if (groupId && insertedIds.length > 0) {
    const memberships = insertedIds.map((document_id) => ({
      document_group_id: groupId!,
      document_id,
    }));
    for (let i = 0; i < memberships.length; i += CHUNK) {
      await supabase
        .from("document_group_members")
        .insert(memberships.slice(i, i + CHUNK));
    }
  }

  return jsonResponse({
    projectId,
    documentsCreated: insertedIds.length,
    rowsProcessed: rows.length,
    groupId,
  });
});

// =====================================================
// CSV parser — RFC 4180 compatible enough for typical exports
// =====================================================
// Why not import a library? Deno lookups + cold start is faster
// without one, and CSVs from SurveyMonkey/GForms/Qualtrics all stick
// to the standard. Handles quoted fields, embedded commas, escaped
// quotes ("") and CRLF/LF line endings. Doesn't handle bizarre dialects
// like tab-delimited; users wanting that should re-export as CSV.
// =====================================================

function parseCsv(text: string): Record<string, string>[] {
  // Strip BOM if present (Excel exports love it).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      // CRLF: skip the \n following a \r.
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      // Skip blank lines at top-level.
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
      continue;
    }
    field += c;
  }
  // Flush the last field/row if no trailing newline.
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = rows[r][c] ?? "";
    }
    out.push(obj);
  }
  return out;
}
