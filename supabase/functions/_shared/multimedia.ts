// Multimedia helpers for process-document.
// All API calls are gated on env vars and fall back gracefully if the
// key is missing, so the app never blocks on a missing OpenAI key.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
// Haiku 4.5 supports vision and is ~3x cheaper than Sonnet. For
// "describe + OCR" of a research-image (field photo, screenshot,
// poster) Haiku's quality is indistinguishable from Sonnet's in our
// evals, and the prompt explicitly tells it not to interpret — just
// describe and transcribe — which is exactly the regime where the
// gap closes to zero.
const VISION_MODEL = "claude-haiku-4-5";
const WHISPER_MODEL = "whisper-1";

const VISION_PROMPT = `Eres un asistente de análisis cualitativo. Recibirás una imagen de un proyecto de investigación cualitativa (foto de campo, captura de pantalla, póster, gráfico, diagrama, etc).

Devuelve un texto en español con tres secciones separadas por dos líneas en blanco:

1. DESCRIPCIÓN: 2-3 frases describiendo qué se ve.
2. TEXTO LITERAL: si hay texto visible (carteles, etiquetas, subtítulos), transcríbelo literalmente. Si no hay texto, escribe "(sin texto)".
3. ELEMENTOS: lista breve, separada por comas, de objetos/personas/conceptos relevantes.

No inventes interpretaciones. Sé conciso (máx 200 palabras totales).`;

interface ImageDescription {
  text: string;
  model: string;
}

/**
 * Ask Claude vision to describe an image and transcribe any visible text.
 * Returns a synthetic "transcript" suitable for full-text search and embedding.
 */
export async function describeImage(
  imageBytes: Uint8Array,
  mimeType: string
): Promise<ImageDescription> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY for image processing");
  }

  // Anthropic accepts base64-encoded images inline.
  const b64 = base64Encode(imageBytes);
  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const media = supported.includes(mimeType) ? mimeType : "image/jpeg";

  const body = {
    // Hard cap output: the prompt already enforces ~200 words and the
    // structured 3-section format, so we never need 800 tokens. Lower
    // ceiling = lower bill on output ($5/MTok) and faster responses.
    model: VISION_MODEL,
    max_tokens: 400,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: media, data: b64 },
          },
          { type: "text", text: VISION_PROMPT },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude vision error ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  const block = data.content?.find((c: { type: string }) => c.type === "text");
  return {
    text: block?.text ?? "",
    model: data.model ?? VISION_MODEL,
  };
}

interface TranscribeResult {
  fullText: string;
  segments: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }>;
  model: string;
}

/**
 * Transcribe audio with OpenAI Whisper. Returns full text + segments
 * for time-anchored quotations. Throws if the key is missing — caller
 * should catch and degrade gracefully.
 */
export async function transcribeAudio(
  audioBytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("MISSING_OPENAI_KEY");
  }

  const form = new FormData();
  form.append("file", new Blob([audioBytes], { type: mimeType }), filename);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "verbose_json");
  form.append("language", "es"); // hint, Whisper still auto-detects

  const res = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper error ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = await res.json() as {
    text: string;
    segments?: Array<{ id: number; start: number; end: number; text: string }>;
  };

  const segments = (data.segments ?? []).map((s, i) => ({
    index: i,
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: s.text.trim(),
  }));
  return {
    fullText: data.text ?? "",
    segments,
    model: WHISPER_MODEL,
  };
}

// --- helpers ---

function base64Encode(bytes: Uint8Array): string {
  // Avoid btoa() argument-length limits (~64KB on some runtimes) by
  // chunking the binary string before encoding.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
