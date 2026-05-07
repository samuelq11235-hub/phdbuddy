// Edge Function: project-chat
// Conversational analysis: retrieve relevant quotations + chunks for the
// user's question, then ask Claude to answer grounded only in that context.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { embedQuery } from "../_shared/voyage.ts";
import { callClaude, CLAUDE_MODEL } from "../_shared/claude.ts";
import { buildChatSystemPrompt, chatUserPrompt } from "../_shared/prompts.ts";
import type { ChatCitation } from "../_shared/types.ts";

interface RequestBody {
  projectId: string;
  sessionId?: string; // if missing, a new session is created
  question: string;
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

  const { projectId, question } = body;
  let sessionId = body.sessionId;
  if (!projectId || !question?.trim()) {
    return errorResponse("Missing projectId or question", 400);
  }

  const supabase = getServiceClient();

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name, research_question, methodology")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (pErr || !project) return errorResponse("Project not found", 404);

  // Ensure a session
  if (!sessionId) {
    const title = question.trim().slice(0, 80);
    const { data: s, error: sErr } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, project_id: projectId, title })
      .select("id")
      .single();
    if (sErr || !s) return errorResponse(`Failed to create session: ${sErr?.message}`, 500);
    sessionId = s.id;
  }

  // Persist the user message immediately
  await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role: "user",
    content: question,
    citations: [],
  });

  // Embed the question
  let queryVec: number[];
  try {
    queryVec = await embedQuery(question);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Embedding failed", 500);
  }

  // Retrieve quotations + chunks in parallel
  const [quoteRes, chunkRes] = await Promise.all([
    supabase.rpc("match_project_quotations", {
      query_embedding: queryVec,
      match_project_id: projectId,
      match_threshold: 0.4,
      match_count: 8,
    }),
    supabase.rpc("match_project_chunks", {
      query_embedding: queryVec,
      match_project_id: projectId,
      match_threshold: 0.35,
      match_count: 6,
    }),
  ]);

  type QMatch = { id: string; document_id: string; content: string; similarity: number };
  type CMatch = { id: string; document_id: string; chunk_index: number; content: string; similarity: number };

  const quoteMatches = (quoteRes.data ?? []) as QMatch[];
  const chunkMatches = (chunkRes.data ?? []) as CMatch[];

  // Resolve doc titles + codes per quotation
  const docIds = Array.from(
    new Set([...quoteMatches.map((q) => q.document_id), ...chunkMatches.map((c) => c.document_id)])
  );
  const docTitles = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title")
      .in("id", docIds);
    for (const d of docs ?? []) docTitles.set(d.id, d.title);
  }

  const codesByQuote = new Map<string, string[]>();
  if (quoteMatches.length > 0) {
    const { data: rels } = await supabase
      .from("quotation_codes")
      .select("quotation_id, codes(name)")
      .in("quotation_id", quoteMatches.map((q) => q.id));
    for (const r of rels ?? []) {
      const r2 = r as { quotation_id: string; codes: { name: string } | null };
      if (!r2.codes) continue;
      const list = codesByQuote.get(r2.quotation_id) ?? [];
      list.push(r2.codes.name);
      codesByQuote.set(r2.quotation_id, list);
    }
  }

  const promptQuotes = quoteMatches.map((q, i) => ({
    ref: `Q${i + 1}`,
    content: q.content,
    document_title: docTitles.get(q.document_id) ?? "(sin título)",
    codes: codesByQuote.get(q.id) ?? [],
  }));
  const promptChunks = chunkMatches.map((c, i) => ({
    ref: `C${i + 1}`,
    content: c.content,
    document_title: docTitles.get(c.document_id) ?? "(sin título)",
  }));

  let answer: string;
  let model: string;
  try {
    const resp = await callClaude(
      [
        {
          role: "user",
          content: chatUserPrompt({
            question,
            quotations: promptQuotes,
            chunks: promptChunks,
          }),
        },
      ],
      {
        // System now embeds project metadata (name, research question,
        // methodology). It's byte-identical for every turn of a chat
        // session, so caching it cuts input cost by ~85% from turn 2
        // onward. Cache TTL is ~5 min; a typical conversation fits.
        system: buildChatSystemPrompt({
          name: project.name,
          research_question: project.research_question,
          methodology: project.methodology,
        }),
        cachePrompt: true,
        maxTokens: 1500,
        temperature: 0.3,
      }
    );
    answer = resp.text;
    model = resp.model;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Claude failed", 500);
  }

  const citations: ChatCitation[] = [
    ...quoteMatches.map((q, i) => ({
      type: "quotation" as const,
      id: q.id,
      document_id: q.document_id,
      document_title: docTitles.get(q.document_id),
      content: q.content,
      similarity: q.similarity,
      ref: `Q${i + 1}`,
    })),
    ...chunkMatches.map((c, i) => ({
      type: "chunk" as const,
      id: c.id,
      document_id: c.document_id,
      document_title: docTitles.get(c.document_id),
      content: c.content,
      similarity: c.similarity,
      ref: `C${i + 1}`,
    })),
  ];

  // Persist the assistant message
  const { data: msg, error: mErr } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role: "assistant",
      content: answer,
      citations,
    })
    .select()
    .single();
  if (mErr) return errorResponse(`Failed to save reply: ${mErr.message}`, 500);

  await supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);

  return jsonResponse({
    ok: true,
    sessionId,
    message: msg,
    model: model ?? CLAUDE_MODEL,
  });
});
