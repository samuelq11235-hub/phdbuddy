// Edge Function: summarize-document
// Asks Claude (Sonnet) to produce a structured summary of a single
// document: an abstract, the dominant themes, key actors, and notable
// quotes (with original character offsets so the UI can deep-link to
// them in the document viewer).
//
// We persist the result in `documents.source_metadata.summary` so the
// next time the user opens the doc the summary is instant and free.
// The summary is a one-shot, not a chat — no session, no caching
// across calls (each doc is unique anyway).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool, CLAUDE_MODEL } from "../_shared/claude.ts";

interface RequestBody {
  documentId: string;
  // When true, regenerates even if a cached summary exists.
  refresh?: boolean;
}

interface SummaryResult {
  abstract: string;
  themes: { name: string; description: string }[];
  actors: { name: string; role: string }[];
  notable_quotes: {
    text: string;
    why_notable: string;
  }[];
  generated_at: string;
  model: string;
}

const SUMMARY_TOOL_SCHEMA = {
  type: "object",
  required: ["abstract", "themes"],
  properties: {
    abstract: {
      type: "string",
      description: "Resumen ejecutivo del documento en 2-4 frases (~120-180 palabras).",
    },
    themes: {
      type: "array",
      description: "3-6 temas dominantes que articulan el documento.",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "Etiqueta corta del tema (2-5 palabras)." },
          description: {
            type: "string",
            description: "Una sola oración explicando cómo se manifiesta el tema.",
          },
        },
      },
    },
    actors: {
      type: "array",
      description:
        "Hasta 5 actores, organizaciones o roles que aparecen prominentemente. Omite si no aplica.",
      items: {
        type: "object",
        required: ["name", "role"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Cómo o por qué aparece este actor." },
        },
      },
    },
    notable_quotes: {
      type: "array",
      description:
        "2-5 citas literales (subcadenas EXACTAS del documento) que sintetizan el material.",
      items: {
        type: "object",
        required: ["text", "why_notable"],
        properties: {
          text: { type: "string" },
          why_notable: {
            type: "string",
            description: "Una oración corta explicando por qué esta cita es relevante.",
          },
        },
      },
    },
  },
};

const SUMMARY_SYSTEM_PROMPT = `Eres analista cualitativo senior. Lees un documento de un proyecto de investigación y devuelves una síntesis estructurada y fiel al texto. No inventes hechos. Las citas literales DEBEN ser subcadenas exactas del documento — no parafrasees. Responde en el idioma del documento.`;

function buildPrompt(args: {
  title: string;
  kind: string | null;
  text: string;
  researchQuestion: string | null;
  methodology: string | null;
}): string {
  const ctx: string[] = [];
  if (args.researchQuestion) ctx.push(`Pregunta de investigación: ${args.researchQuestion}`);
  if (args.methodology) ctx.push(`Metodología: ${args.methodology}`);
  return `${ctx.length ? ctx.join("\n") + "\n\n" : ""}Documento (${args.kind ?? "other"}): ${args.title}
"""
${args.text}
"""

Tarea: produce el resumen estructurado. Las citas notables tienen que ser literales — copia y pega del documento, no parafrasees.`;
}

// Cap document text we send to Claude. ~24K chars ≈ 7K input tokens —
// leaves room for the schema + the response without hitting the
// per-minute limit on long projects.
const MAX_INPUT_CHARS = 24_000;

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

  if (!body.documentId) return errorResponse("Missing documentId", 400);

  const supabase = getServiceClient();

  const { data: doc, error: dErr } = await supabase
    .from("documents")
    .select("id, project_id, user_id, title, kind, full_text, source_metadata")
    .eq("id", body.documentId)
    .eq("user_id", userId)
    .single();
  if (dErr || !doc) return errorResponse("Document not found", 404);
  if (!doc.full_text || doc.full_text.length < 200) {
    return errorResponse(
      "El documento no se ha procesado todavía o tiene muy poco texto para resumir.",
      400
    );
  }

  const meta = (doc.source_metadata ?? {}) as Record<string, unknown>;
  const cached = meta.summary as SummaryResult | undefined;
  if (cached && !body.refresh) {
    return jsonResponse({ ok: true, summary: cached, cached: true });
  }

  // Pull the project for research-question context.
  const { data: project } = await supabase
    .from("projects")
    .select("research_question, methodology")
    .eq("id", doc.project_id)
    .single();

  const text = doc.full_text.length > MAX_INPUT_CHARS
    ? doc.full_text.slice(0, MAX_INPUT_CHARS)
    : doc.full_text;

  let result: SummaryResult;
  try {
    const r = await callClaudeTool<{
      abstract: string;
      themes: { name: string; description: string }[];
      actors?: { name: string; role: string }[];
      notable_quotes?: { text: string; why_notable: string }[];
    }>(
      [
        {
          role: "user",
          content: buildPrompt({
            title: doc.title,
            kind: doc.kind,
            text,
            researchQuestion: project?.research_question ?? null,
            methodology: project?.methodology ?? null,
          }),
        },
      ],
      {
        system: SUMMARY_SYSTEM_PROMPT,
        toolName: "submit_summary",
        toolDescription:
          "Devuelve la síntesis estructurada del documento (abstract, temas, actores, citas notables).",
        inputSchema: SUMMARY_TOOL_SCHEMA,
        maxTokens: 1500,
        temperature: 0.2,
        // System + schema are deterministic — caching helps the second
        // doc summarise faster.
        cachePrompt: true,
      }
    );

    result = {
      abstract: r.data.abstract,
      themes: r.data.themes ?? [],
      actors: r.data.actors ?? [],
      notable_quotes: r.data.notable_quotes ?? [],
      generated_at: new Date().toISOString(),
      model: r.model ?? CLAUDE_MODEL,
    };
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Claude failed", 500);
  }

  // Persist into documents.source_metadata.summary so the next request
  // is free. We merge rather than overwrite to preserve other metadata.
  const { error: updErr } = await supabase
    .from("documents")
    .update({
      source_metadata: { ...meta, summary: result },
    })
    .eq("id", doc.id);
  if (updErr) {
    console.warn("[summarize-document] persist failed:", updErr.message);
  }

  return jsonResponse({ ok: true, summary: result, cached: false });
});
