// Edge Function: process-document
// Extract text from an uploaded document, chunk it, embed every chunk
// with Voyage, and persist everything for downstream coding & RAG.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { extractTextFromBuffer } from "../_shared/pdf.ts";
import { chunkText, approxTokens } from "../_shared/chunking.ts";
import { embedTexts, VoyageRateLimitError } from "../_shared/voyage.ts";
import { describeImage, transcribeAudio } from "../_shared/multimedia.ts";

interface RequestBody {
  documentId: string;
}

const IMAGE_KINDS = new Set(["image"]);
const AV_KINDS = new Set(["audio", "video"]);

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

  const { documentId } = body;
  if (!documentId) return errorResponse("Missing documentId", 400);

  const supabase = getServiceClient();

  const { data: doc, error: fetchErr } = await supabase
    .from("documents")
    .select("id, user_id, project_id, title, kind, storage_path, full_text, status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !doc) return errorResponse("Document not found", 404);

  await supabase
    .from("documents")
    .update({ status: "processing", error_message: null })
    .eq("id", documentId);

  try {
    let fullText = doc.full_text ?? "";
    let pageCount: number | null = null;

    // Multimedia branches: short-circuit text extraction.
    if (IMAGE_KINDS.has(doc.kind) && doc.storage_path) {
      fullText = await processImage(supabase, doc);
    } else if (AV_KINDS.has(doc.kind) && doc.storage_path) {
      fullText = await processAudioVideo(supabase, doc);
    } else if (doc.storage_path) {
      // Plain-text inline docs are uploaded by writing full_text directly
      // (no storage_path). Anything with a storage_path needs extraction.
      const { data: file, error: dlErr } = await supabase.storage
        .from("documents")
        .download(doc.storage_path);

      if (dlErr || !file) {
        throw new Error(`Failed to download file: ${dlErr?.message ?? "unknown"}`);
      }

      const buffer = await file.arrayBuffer();
      const extracted = await extractTextFromBuffer(buffer);
      fullText = extracted.text;
      pageCount = extracted.pageCount;
    }

    // Multimedia documents don't always produce text (no Whisper key,
    // image with no recognisable content). We accept them as-is and
    // skip chunking — the document is still openable in the viewer.
    const isMultimedia =
      IMAGE_KINDS.has(doc.kind) || AV_KINDS.has(doc.kind);

    if (!isMultimedia && (!fullText || fullText.trim().length < 50)) {
      throw new Error(
        "No se pudo extraer suficiente texto de este documento. " +
          "Si es un PDF escaneado, primero pásalo por OCR o pega la transcripción en línea."
      );
    }
    if (isMultimedia && (!fullText || fullText.trim().length === 0)) {
      // No transcript / description available — finish without chunking.
      await supabase
        .from("documents")
        .update({ status: "ready", word_count: 0, page_count: null })
        .eq("id", documentId);
      return jsonResponse({
        ok: true,
        documentId,
        pageCount: null,
        wordCount: 0,
        chunkCount: 0,
        kind: doc.kind,
        notice: "Multimedia procesado sin transcripción/descripción",
      });
    }

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    await supabase
      .from("documents")
      .update({
        full_text: fullText,
        page_count: pageCount,
        word_count: wordCount,
      })
      .eq("id", documentId);

    // Chunk + embed for RAG / theme discovery / chat.
    const chunks = chunkText(fullText, 800, 80);
    if (chunks.length === 0) throw new Error("Document produced no text chunks.");

    const offsets = computeOffsets(fullText, chunks);

    // Voyage's free tier (no payment method) is 3 RPM and 10K TPM. With
    // ~800 tokens per chunk, 4 chunks per batch ≈ 3200 tokens/request,
    // which fits comfortably under 10K TPM and lets us issue 3 requests
    // per minute without burning the budget. The embedTexts() helper
    // retries on 429 with long backoff, so even rate-limited accounts
    // eventually succeed (within the 150s/400s edge function ceiling).
    const BATCH_SIZE = 4;
    const INTER_BATCH_DELAY_MS = 250;

    const rows: Array<{
      document_id: string;
      project_id: string;
      chunk_index: number;
      content: string;
      tokens: number;
      start_offset: number | null;
      end_offset: number | null;
      embedding: number[];
    }> = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const { embeddings } = await embedTexts(batch, { inputType: "document" });
      for (let j = 0; j < batch.length; j++) {
        const idx = i + j;
        rows.push({
          document_id: documentId,
          project_id: doc.project_id,
          chunk_index: idx,
          content: batch[j],
          tokens: approxTokens(batch[j]),
          start_offset: offsets[idx]?.start ?? null,
          end_offset: offsets[idx]?.end ?? null,
          embedding: embeddings[j],
        });
      }
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
      }
    }

    await supabase.from("document_chunks").delete().eq("document_id", documentId);
    const { error: insErr } = await supabase.from("document_chunks").insert(rows);
    if (insErr) throw new Error(`Failed to insert chunks: ${insErr.message}`);

    await supabase.from("documents").update({ status: "ready" }).eq("id", documentId);

    return jsonResponse({
      ok: true,
      documentId,
      pageCount,
      wordCount,
      chunkCount: rows.length,
    });
  } catch (err) {
    let message = err instanceof Error ? err.message : "Unknown processing error";
    let status = 500;

    if (err instanceof VoyageRateLimitError) {
      message =
        "Voyage AI alcanzó el límite de su nivel gratuito (3 peticiones/min). " +
        "Añade un método de pago en https://dashboard.voyageai.com/ " +
        "(los primeros 200M tokens siguen siendo gratis) o sube documentos más cortos. " +
        "Después puedes pulsar 'Reprocesar' para reintentarlo.";
      status = 429;
    }

    console.error("[process-document] failed:", err);
    await supabase
      .from("documents")
      .update({ status: "error", error_message: message })
      .eq("id", documentId);
    return errorResponse(message, status);
  }
});

/**
 * Image branch: Claude vision describes the image and transcribes any
 * visible text. The output becomes the document's full_text so it can
 * be searched, embedded for RAG, and used in chat.
 */
async function processImage(
  supabase: ReturnType<typeof getServiceClient>,
  doc: { id: string; storage_path: string }
): Promise<string> {
  const { data: file, error } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);
  if (error || !file) {
    throw new Error(`Image download failed: ${error?.message ?? "unknown"}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = (file as Blob).type || "image/jpeg";

  try {
    const { text } = await describeImage(bytes, mime);
    return text;
  } catch (err) {
    console.warn("[process-document] image vision failed:", err);
    return ""; // accept the image without a description
  }
}

/**
 * Audio/video branch: Whisper transcribes the file and we persist
 * per-segment rows so the viewer can jump to time ranges. Whole-file
 * full_text is also returned for search/embedding.
 *
 * For video, Whisper can ingest mp4/webm directly and pulls the audio
 * track itself, so no ffmpeg dance is needed in the edge runtime.
 *
 * If OPENAI_API_KEY is unset, returns "" so the document still opens.
 */
async function processAudioVideo(
  supabase: ReturnType<typeof getServiceClient>,
  doc: { id: string; storage_path: string; kind: string }
): Promise<string> {
  const { data: file, error } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);
  if (error || !file) {
    throw new Error(`Media download failed: ${error?.message ?? "unknown"}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = (file as Blob).type || (doc.kind === "video" ? "video/mp4" : "audio/mpeg");
  const filename = doc.storage_path.split("/").pop() ?? "media";

  try {
    const { fullText, segments } = await transcribeAudio(bytes, filename, mime);

    if (segments.length > 0) {
      // Replace any prior segments for this document.
      await supabase.from("document_transcript").delete().eq("document_id", doc.id);
      const rows = segments.map((s) => ({
        document_id: doc.id,
        segment_index: s.index,
        start_ms: s.startMs,
        end_ms: s.endMs,
        text: s.text,
      }));
      const { error: insErr } = await supabase.from("document_transcript").insert(rows);
      if (insErr) console.warn("[process-document] transcript insert:", insErr.message);
    }

    return fullText;
  } catch (err) {
    if (err instanceof Error && err.message === "MISSING_OPENAI_KEY") {
      console.warn("[process-document] OPENAI_API_KEY missing — skipping transcription");
      return "";
    }
    console.warn("[process-document] transcription failed:", err);
    return "";
  }
}

// Best-effort: locate every chunk in the original text to recover its
// character offsets (used later to map chat citations back to a position
// in the document viewer).
function computeOffsets(
  fullText: string,
  chunks: string[]
): Array<{ start: number; end: number } | null> {
  const out: Array<{ start: number; end: number } | null> = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const head = chunk.slice(0, 64);
    const idx = fullText.indexOf(head, cursor);
    if (idx === -1) {
      out.push(null);
      continue;
    }
    out.push({ start: idx, end: Math.min(fullText.length, idx + chunk.length) });
    cursor = idx + Math.max(1, Math.floor(chunk.length / 2));
  }
  return out;
}
