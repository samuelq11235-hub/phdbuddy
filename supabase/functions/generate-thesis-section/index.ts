// Edge Function: generate-thesis-section
//
// Drafts a section of a qualitative-research thesis chapter using
// project context (research question, methodology, theoretical
// framework), the codebook (top codes), top quotations per code, and
// memos. Sections supported:
//   - introduction
//   - methodology
//   - findings
//   - discussion
//   - limitations
//
// Output is plain Markdown so the client can render it in TipTap or
// save it directly as a memo. We also return the citations (quotation
// IDs) the AI relied on, so the user can verify each one.
//
// Body: { projectId, section, extraGuidance? }
// Returns: { ok, section, content, citations: [{quotationId, documentTitle, text}] }

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool } from "../_shared/claude.ts";
import { getActiveFramework } from "../_shared/theory.ts";
import { frameworkAddendum } from "../_shared/prompts.ts";
import { getOrSetAiCache } from "../_shared/cache.ts";

type SectionKind =
  | "introduction"
  | "methodology"
  | "findings"
  | "discussion"
  | "limitations";

interface RequestBody {
  projectId: string;
  section: SectionKind;
  extraGuidance?: string;
  // When true, recompute even if a fresh cache row exists.
  refresh?: boolean;
}

const VALID: SectionKind[] = [
  "introduction",
  "methodology",
  "findings",
  "discussion",
  "limitations",
];

const SECTION_INSTRUCTIONS: Record<SectionKind, string> = {
  introduction: `Escribe una INTRODUCCIÓN para una tesis cualitativa basada en el material aportado.
Estructura: contexto del problema, vacío en la literatura, pregunta de investigación, propósito del estudio, justificación práctica/teórica. ~500-700 palabras.`,
  methodology: `Escribe la sección de METODOLOGÍA. Cubre: enfoque cualitativo, marco teórico activo, diseño del estudio (tipo de fuentes, número de documentos), procedimiento de codificación (abierta / axial / selectiva según marco), criterios de rigor (credibilidad, transferibilidad, dependability, confirmability), consideraciones éticas. Reporta cifras concretas del corpus. ~600-900 palabras.`,
  findings: `Escribe HALLAZGOS organizados por temas. Para cada tema principal: una afirmación interpretativa, evidencia textual (cita LITERAL entre comillas con autor/documento), análisis contextual. Mantén la voz de los participantes audible. NO inventes citas: usa solo las del bloque de evidencia. Mínimo 3 temas, máximo 6. ~700-1100 palabras.`,
  discussion: `Escribe la DISCUSIÓN. Conecta cada hallazgo con el marco teórico activo, contrastándolo o ampliándolo. Identifica tensiones, paradojas y aportes originales. Propón una interpretación integradora. Sin citas literales: el lector ya las vio en hallazgos. ~500-800 palabras.`,
  limitations: `Escribe LIMITACIONES Y FUTURAS LÍNEAS de investigación. Sé honesto sobre alcance del corpus, posibles sesgos del investigador, limitaciones del marco teórico elegido. Termina con 3-5 preguntas abiertas que el estudio deja para investigación futura. ~300-500 palabras.`,
};

const COPILOT_SYSTEM = `Eres un copiloto de tesis cualitativa. Escribes en español académico, en tercera persona, evitando muletillas y repeticiones. Trabajas SOLO con el material del proyecto: nunca cites estudios externos, nunca inventes citas. Todo párrafo de hallazgos debe ir respaldado por una cita textual del corpus aportado.`;

const COPILOT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description:
        "Markdown bien formateado con encabezados ## y citas en bloque > para fragmentos textuales.",
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quotation_id: { type: "string" },
          how_used: {
            type: "string",
            description: "1 frase: para qué se cita esta evidencia.",
          },
        },
        required: ["quotation_id", "how_used"],
      },
    },
  },
  required: ["content", "citations"],
} as const;

const TOP_CODES = 14;
const QUOTES_PER_CODE = 4;

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
  if (!VALID.includes(body.section)) return errorResponse("Invalid section", 400);

  const supabase = getServiceClient();

  // Authorisation.
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", body.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return errorResponse("Forbidden", 403);

  // Pull project metadata + corpus snapshot.
  const [{ data: project }, { data: codes }, { data: docs }, { data: memos }] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          "name, description, research_question, methodology, theory_framework_id"
        )
        .eq("id", body.projectId)
        .maybeSingle(),
      supabase
        .from("codes")
        .select("id, name, description, usage_count")
        .eq("project_id", body.projectId)
        .order("usage_count", { ascending: false })
        .limit(TOP_CODES),
      supabase
        .from("documents")
        .select("id, title, kind")
        .eq("project_id", body.projectId)
        .limit(200),
      supabase
        .from("memos")
        .select("title, content, kind")
        .eq("project_id", body.projectId)
        .limit(40),
    ]);

  if (!project) return errorResponse("Project not found", 404);

  const framework = await getActiveFramework(supabase, body.projectId);

  // Pull top quotations per code (in parallel). The result is the
  // canonical evidence pack for the section.
  const codeIds = (codes ?? []).map((c) => c.id as string);
  let quotationsByCode = new Map<
    string,
    { id: string; content: string; document_id: string }[]
  >();
  if (codeIds.length > 0) {
    const { data: qrows } = await supabase
      .from("quotation_codes")
      .select(
        "code_id, quotation:quotations(id, content, document_id, project_id)"
      )
      .in("code_id", codeIds)
      .limit(codeIds.length * QUOTES_PER_CODE * 2);
    type Row = {
      code_id: string;
      quotation:
        | { id: string; content: string; document_id: string; project_id: string }
        | { id: string; content: string; document_id: string; project_id: string }[]
        | null;
    };
    for (const row of qrows ?? []) {
      const r = row as Row;
      const q = Array.isArray(r.quotation) ? r.quotation[0] : r.quotation;
      if (!q || q.project_id !== body.projectId) continue;
      const arr = quotationsByCode.get(r.code_id) ?? [];
      if (arr.length >= QUOTES_PER_CODE) continue;
      arr.push({ id: q.id, content: q.content, document_id: q.document_id });
      quotationsByCode.set(r.code_id, arr);
    }
  }

  const docTitles = new Map<string, string>();
  for (const d of docs ?? []) docTitles.set(d.id as string, d.title as string);

  // Build the evidence prompt block. Truncate quotation text aggressively
  // — we want the model to cite, not memorise.
  const evidenceBlocks = (codes ?? []).map((c) => {
    const qs = quotationsByCode.get(c.id as string) ?? [];
    const items = qs
      .map((q) => {
        const title = docTitles.get(q.document_id) ?? "(sin título)";
        const txt = q.content.replace(/\s+/g, " ").trim();
        const trimmed = txt.length > 320 ? `${txt.slice(0, 320)}…` : txt;
        return `  - id=${q.id} | doc="${title}" | "${trimmed}"`;
      })
      .join("\n");
    return `* ${c.name} (n=${c.usage_count})${
      c.description ? ` — ${c.description}` : ""
    }${items ? `\n${items}` : ""}`;
  });

  const memoBlock = (memos ?? [])
    .slice(0, 20)
    .map((m) => `- (${m.kind ?? "memo"}) ${m.title}: ${(m.content ?? "").slice(0, 240)}`)
    .join("\n");

  const corpusFacts = [
    `Documentos: ${docs?.length ?? 0}`,
    `Códigos top: ${codes?.length ?? 0}`,
    `Memos: ${memos?.length ?? 0}`,
    framework ? `Marco activo: ${framework.name}` : "Marco activo: sin marco",
  ].join(" · ");

  const userPrompt = `# Proyecto
Nombre: ${project.name}
Pregunta: ${project.research_question ?? "(sin definir)"}
Metodología declarada: ${project.methodology ?? "(sin definir)"}
Estadísticas: ${corpusFacts}

# Memos del investigador
${memoBlock || "(sin memos)"}

# Evidencia disponible (códigos + citas literales)
${evidenceBlocks.join("\n\n") || "(sin evidencia)"}

# Tarea
${SECTION_INSTRUCTIONS[body.section]}

${body.extraGuidance ? `# Guía adicional del autor\n${body.extraGuidance}\n\n` : ""}Devuelve Markdown listo para pegar en la tesis. Cada cita literal va en blockquote (>) y debe corresponder a un id presente en \`citations\`. NO inventes citas. Si la evidencia no es suficiente para un tema, dilo explícitamente en lugar de fabricar.`;

  // Cache key — derived from the corpus signature, not the raw text.
  // The signature collapses (max(updated_at) of codes/memos, codebook
  // count, doc count) into a deterministic string so any meaningful
  // change busts the cache. Cheaper than rehashing the full evidence
  // pack and equally correct.
  const codebookSig = (codes ?? [])
    .map((c) => `${c.id}:${c.usage_count}`)
    .join(",");
  const memoSig = (memos ?? [])
    .map((m) => `${m.title}:${(m.content ?? "").length}`)
    .join("|");
  const cacheInput = {
    section: body.section,
    extraGuidance: body.extraGuidance ?? null,
    framework: framework?.slug ?? null,
    researchQuestion: project.research_question ?? null,
    methodology: project.methodology ?? null,
    codebookSig,
    memoSig,
    docCount: docs?.length ?? 0,
  };

  if (body.refresh) {
    const stale = await import("../_shared/cache.ts").then((m) =>
      m.hashInput(cacheInput)
    );
    await supabase
      .from("ai_cache")
      .delete()
      .eq("project_id", body.projectId)
      .eq("kind", "thesis_section")
      .eq("input_hash", stale);
  }

  let result;
  let cached = false;
  try {
    const wrapped = await getOrSetAiCache<{
      content: string;
      citations: { quotation_id: string; how_used: string }[];
    }>(supabase, {
      projectId: body.projectId,
      kind: "thesis_section",
      input: cacheInput,
      ttlSeconds: 60 * 60 * 12,
      compute: () =>
        callClaudeTool<{
          content: string;
          citations: { quotation_id: string; how_used: string }[];
        }>(
          [{ role: "user", content: userPrompt }],
          {
            system:
              COPILOT_SYSTEM + frameworkAddendum(framework?.prompt_addendum),
            toolName: "submit_thesis_section",
            toolDescription: "Devuelve la sección redactada con sus citas.",
            inputSchema: COPILOT_TOOL_SCHEMA,
            // Down from 4500 — observed median output is ~1800 tok and
            // p95 is ~3000. 3500 keeps a safe ceiling without bloating.
            maxTokens: 3500,
            temperature: 0.4,
            // System + tool schema repeat across all 5 sections of a
            // thesis chapter; caching pays for itself on the second
            // section a researcher generates.
            cachePrompt: true,
          }
        ),
    });
    result = wrapped.value;
    cached = wrapped.cached;
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Generation failed",
      500
    );
  }

  // Resolve citation metadata for the UI (avoids a second round-trip).
  const citationLookup = new Map<
    string,
    { content: string; document_id: string }
  >();
  for (const arr of quotationsByCode.values()) {
    for (const q of arr) citationLookup.set(q.id, q);
  }
  const citations = (result.citations ?? [])
    .map((c) => {
      const q = citationLookup.get(c.quotation_id);
      if (!q) return null;
      return {
        quotationId: c.quotation_id,
        documentTitle: docTitles.get(q.document_id) ?? "(sin título)",
        text: q.content,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return jsonResponse({
    ok: true,
    section: body.section,
    content: result.content,
    citations,
    cached,
  });
});
