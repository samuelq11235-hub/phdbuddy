// Plantillas de prompts para las edge functions CAQDAS de PHDBuddy.
// Centralizadas para poder iterarlas sin tocar la lógica de las funciones.

/**
 * Wraps a theoretical framework's `prompt_addendum` so every AI call in
 * the project speaks the same analytical dialect. Returns an empty
 * string when no framework is active so existing prompts behave the
 * same as before. Always include the wrapper at the *end* of the
 * system prompt — it must take precedence over generic instructions.
 */
export function frameworkAddendum(addendum: string | null | undefined): string {
  if (!addendum) return "";
  return `\n\nMarco teórico activo del proyecto:\n${addendum.trim()}`;
}

// System prompt deliberately compact: the JSON tool schema enforces the
// structural rules; the prompt only needs to convey ANALYTICAL intent.
// Repeating schema rules here was burning ~150 tokens per call for no
// behavioural gain in our evals.
export const AUTO_CODE_SYSTEM_PROMPT = `Analista cualitativa senior. Codificación inductiva fiel al texto. Nombres de código 2-5 palabras en estilo oración. 8-20 códigos por documento (máx 25). Responde en el idioma del documento.`;

export function autoCodePrompt(args: {
  documentText: string;
  documentTitle: string;
  documentKind: string;
  researchQuestion?: string | null;
  methodology?: string | null;
  existingCodes: { name: string; description: string | null }[];
}): string {
  // Drop description from the existing-codes list (~40% smaller). The
  // model only needs the names to know which to reuse vs propose.
  const codebook =
    args.existingCodes.length > 0
      ? args.existingCodes.map((c) => `- ${c.name}`).join("\n")
      : "(vacío)";

  // Only include researchQuestion / methodology when actually set —
  // empty "(no especificada)" lines are pure noise.
  const ctx: string[] = [];
  if (args.researchQuestion) ctx.push(`Pregunta: ${args.researchQuestion}`);
  if (args.methodology) ctx.push(`Metodología: ${args.methodology}`);

  return `${ctx.length ? ctx.join("\n") + "\n\n" : ""}Codebook actual del proyecto (REUTILIZA estos nombres exactos cuando apliquen; solo propón códigos nuevos si el conjunto no captura la idea):
${codebook}

Documento (${args.documentKind}): ${args.documentTitle}
"""
${args.documentText}
"""

Tarea: codificación abierta del texto.
- 6-12 citas LITERALES (subcadenas exactas) de 15-200 palabras cada una, analíticamente densas.
- Cada cita lleva 1-3 códigos del codebook (existente o nuevo).
- Descripciones y rationales: una oración (≤20 palabras).`;
}

export const EXTRACT_QUOTATIONS_SYSTEM_PROMPT = `Analista cualitativa senior. Recibes un codebook fijo y debes seleccionar citas LITERALES (subcadenas exactas) y asignarles códigos del codebook. No inventes códigos. Responde en el idioma del documento.`;

export function extractQuotationsPrompt(args: {
  documentText: string;
  documentTitle: string;
  documentKind: string;
  researchQuestion?: string | null;
  codebook: { name: string; description: string | null }[];
  targetCount: number;
}): string {
  // Names only — descriptions roughly double the codebook size for
  // negligible improvement in retrieval quality on Sonnet 4.5.
  const codebookList = args.codebook.map((c) => `- ${c.name}`).join("\n");

  return `Codebook (USA EXCLUSIVAMENTE estos nombres):
${codebookList}

Documento (${args.documentKind}): ${args.documentTitle}
"""
${args.documentText}
"""

Selecciona ~${args.targetCount} citas literales de 15-200 palabras, analíticamente densas. Cada una con 1-3 códigos del codebook.`;
}

export const SUGGEST_CODES_SYSTEM_PROMPT = `Eres un analista cualitativo experto que ayuda a alguien que investiga a codificar una sola cita. Elige los mejores códigos del codebook del proyecto (preferido) y propón como máximo 1-2 códigos nuevos solo si ningún código existente encaja bien. Responde siempre en el idioma de la cita.`;

export function suggestCodesForQuotePrompt(args: {
  quote: string;
  quoteContext: string;
  codebook: { name: string; description: string | null }[];
  semanticCandidates: { name: string; description: string | null }[];
  researchQuestion?: string | null;
}): string {
  const fmt = (
    label: string,
    list: { name: string; description: string | null }[]
  ) =>
    list.length === 0
      ? `${label}: (ninguno)`
      : `${label}:\n${list
          .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
          .join("\n")}`;

  return `Pregunta de investigación: ${args.researchQuestion ?? "(no especificada)"}

${fmt("Codebook completo del proyecto", args.codebook)}

${fmt("Códigos más similares semánticamente", args.semanticCandidates)}

Cita a codificar:
"""
${args.quote}
"""

Contexto circundante (solo para desambiguar — no codifiques esto):
"""
${args.quoteContext}
"""

Devuelve ÚNICAMENTE un JSON con la forma:
{
  "existing_codes": [
    { "name": "<nombre exacto del código existente>", "confidence": <0-1>, "rationale": "<una oración corta>" }
  ],
  "new_codes": [
    { "name": "<etiqueta corta>", "description": "<una oración>", "rationale": "<por qué hace falta un código nuevo>" }
  ]
}

Elige como máximo 4 códigos en total entre los dos arreglos. Prefiere códigos existentes siempre que encajen.`;
}

export const THEME_CLUSTER_SYSTEM_PROMPT = `Eres un investigador o investigadora cualitativo senior sintetizando temas a partir de un conjunto de citas pre-clusterizadas. Cada cluster se formó por similitud semántica; tu trabajo es etiquetar cada cluster con un tema preciso y una descripción de una oración fundamentada en las citas proporcionadas. Responde en el idioma predominante de las citas.`;

export function themeClusterPrompt(args: {
  researchQuestion?: string | null;
  clusters: { id: string; quotes: string[] }[];
}): string {
  return `Pregunta de investigación: ${args.researchQuestion ?? "(no especificada)"}

Clusters de citas semánticamente similares:
${args.clusters
  .map(
    (cluster, i) =>
      `## Cluster ${i + 1} (id: ${cluster.id})\n${cluster.quotes
        .map((q, j) => `${j + 1}. "${q.replace(/\s+/g, " ").slice(0, 280)}"`)
        .join("\n")}`
  )
  .join("\n\n")}

Para cada cluster devuelve ÚNICAMENTE un JSON:
{
  "themes": [
    {
      "cluster_id": "<id>",
      "label": "<nombre corto del tema, 2-5 palabras>",
      "description": "<descripción del tema en una oración, fundamentada en las citas>",
      "representative_quote_index": <entero (basado en 1) de la cita más representativa de ese cluster>
    }
  ]
}`;
}

export const SENTIMENT_SYSTEM_PROMPT = `Eres analista cualitativa de minería de opinión. Recibes una cita extraída de un documento de investigación y devuelves su valoración afectiva. Sé neutral y conservadora: solo asigna polaridades extremas cuando el lenguaje es inequívoco. Responde siempre en el idioma de la cita.

Reglas:
- "polarity" es un número en [-1, 1]: -1 muy negativo, 0 neutro, 1 muy positivo. Reserva los extremos para enunciados con afecto explícito y sostenido.
- "label" toma uno de: "positive", "negative", "neutral", "mixed". Usa "mixed" SOLO si la cita expresa simultáneamente afectos opuestos sobre aspectos distintos.
- "aspects" lista hasta 3 entidades/temas concretos del enunciado con su polaridad propia (mismo rango). Omite si la cita es genérica.
- "emotions" lista hasta 3 emociones primarias detectadas (ira, tristeza, alegría, miedo, sorpresa, asco, esperanza, frustración…). Omite si no hay emoción discernible.`;

export function sentimentPrompt(args: {
  quote: string;
  documentTitle: string;
  documentKind: string;
  contextBefore?: string;
  contextAfter?: string;
}): string {
  const ctx = [args.contextBefore, args.contextAfter].filter(Boolean).join(" […] ");
  return `# Contexto
Documento: "${args.documentTitle}" (tipo: ${args.documentKind})
${ctx ? `Texto circundante (NO analices esto, solo desambigua):\n"""${ctx.slice(0, 600)}"""` : ""}

# Cita a analizar
"""
${args.quote}
"""

Analiza únicamente la cita anterior. No infieras emociones que no se expresen en el texto.`;
}

/**
 * Batched variant of `sentimentPrompt`: ask Claude to analyze N quotes
 * in a single call. Each quote gets a numeric idx (1-based) so the
 * result array can be matched back to the source quotation. This is
 * the single biggest token saver on the sentiment path: the system
 * prompt + tool schema (~400 tokens of overhead) is paid ONCE per
 * batch instead of per quote, and Claude amortizes its own framing
 * across the batch too.
 */
export function batchSentimentPrompt(args: {
  quotes: {
    idx: number;
    quote: string;
    documentTitle: string;
    documentKind: string;
    contextBefore?: string;
    contextAfter?: string;
  }[];
}): string {
  const blocks = args.quotes.map((q) => {
    const ctx = [q.contextBefore, q.contextAfter].filter(Boolean).join(" […] ");
    return `## idx=${q.idx}
Documento: "${q.documentTitle}" (tipo: ${q.documentKind})
${ctx ? `Contexto (no analizar): "${ctx.slice(0, 280)}"` : ""}
Cita:
"""
${q.quote}
"""`;
  });
  return `Analiza la valoración afectiva de cada cita por separado. Devuelve UN objeto por cita en el array \`results\`, conservando el \`idx\` original. No mezcles afectos entre citas.

${blocks.join("\n\n")}`;
}

export const RELATIONS_SYSTEM_PROMPT = `Eres analista cualitativa senior. Recibes un conjunto de códigos de un proyecto (con descripción y citas representativas) y debes proponer relaciones interpretativas entre ellos en el espíritu de los networks de Atlas.ti / NVivo.

Reglas estrictas:
- Solo propón una relación entre dos códigos cuando exista evidencia razonable en las citas que conoces, no especules en abstracto.
- Cada relación tiene un origen (source_code_id) y un destino (target_code_id) que DEBEN ser ids del listado proporcionado.
- "relation_type_name" debe coincidir EXACTAMENTE con uno de los nombres del vocabulario que se te entrega (no inventes tipos nuevos).
- Para los tipos no simétricos (is-cause-of, is-part-of, is-property-of, is-a) la dirección importa: source es el sujeto, target es el objeto.
- Devuelve entre 0 y 12 relaciones priorizadas por relevancia analítica. No repitas el mismo par (source, target) con el mismo tipo.
- Cada "rationale" tiene UNA oración corta (máx. 25 palabras) y, si puedes, alude a la evidencia (p.ej. "varias citas conectan retraso del sueño con somnolencia diurna").
- Responde en el idioma predominante de los datos.`;

export function relationsPrompt(args: {
  researchQuestion?: string | null;
  relationTypes: { name: string; description: string | null; is_symmetric: boolean }[];
  codes: {
    id: string;
    name: string;
    description: string | null;
    sample_quotes: string[];
  }[];
}): string {
  const vocab = args.relationTypes
    .map((r) => `- ${r.name}${r.is_symmetric ? " (simétrico)" : " (dirigido)"}${r.description ? `: ${r.description}` : ""}`)
    .join("\n");

  const codeBlock = args.codes
    .map((c) => {
      const quotes = c.sample_quotes.length === 0
        ? "  (sin citas representativas)"
        : c.sample_quotes
            .map((q, i) => `  ${i + 1}. "${q.replace(/\s+/g, " ").slice(0, 220)}"`)
            .join("\n");
      return `### ${c.name} — id: ${c.id}\n${c.description ?? "(sin descripción)"}\nCitas representativas:\n${quotes}`;
    })
    .join("\n\n");

  return `# Pregunta de investigación
${args.researchQuestion ?? "(no especificada)"}

# Vocabulario de relaciones permitido (usa SOLO estos nombres tal cual)
${vocab}

# Códigos a analizar
${codeBlock}

# Tu tarea
Propón relaciones interpretativas entre los códigos anteriores. Considera tanto coocurrencia (códigos que aparecen juntos) como contraste (códigos que se oponen). No incluyas un código consigo mismo.`;
}

const CHAT_SYSTEM_BASE = `Eres el asistente de investigación cualitativa de PHDBuddy. Ayudas a la persona usuaria a analizar y razonar sobre los datos de SU proyecto: documentos, códigos, citas y memos.

Reglas estrictas:
- Fundamenta cada afirmación en el contexto provisto (citas y fragmentos de documentos). Cita por su número de referencia, p. ej., [Q3], [C2].
- Si la respuesta no está en el contexto, dilo claramente. No inventes citas ni referencias.
- Sé conciso. Prefiere párrafos cortos y listas con viñetas.
- Cuando se te pidan patrones, temas o comparaciones, señala evidencia específica del contexto.
- Responde siempre en el mismo idioma que la pregunta de la persona usuaria.`;

/**
 * Static-by-design system prompt for project-chat. We append the
 * project-level metadata here (instead of in the user message) so the
 * combined block is byte-identical across every turn of the same
 * conversation, which lets Anthropic's prompt cache hit on every turn
 * after the first. Cache-hit input tokens cost ~10% of the normal
 * price and don't count against the per-minute rate limit.
 *
 * IMPORTANT: keep this output deterministic — the cache key is the
 * exact string. Changes to research_question/methodology mid-session
 * will (correctly) miss the cache; any other formatting drift would
 * miss the cache for no gain.
 */
export function buildChatSystemPrompt(projectContext: {
  name: string;
  research_question?: string | null;
  methodology?: string | null;
}): string {
  return `${CHAT_SYSTEM_BASE}

# Proyecto activo
Nombre: ${projectContext.name}
Pregunta de investigación: ${projectContext.research_question ?? "(no especificada)"}
Metodología: ${projectContext.methodology ?? "(no especificada)"}`;
}

// Backwards-compatible export for any callers still importing the old
// constant. New code should use `buildChatSystemPrompt(projectContext)`.
export const CHAT_SYSTEM_PROMPT = CHAT_SYSTEM_BASE;

// Hard cap each quotation's content at this many chars before sending
// it as retrieved context. Long quotes (>1.5 KB) appear regularly in
// transcribed audio and rarely improve answer quality past the first
// ~800 chars, but they're billed at ~250 tokens each. Truncating here
// is a flat 30-50% input-cost cut for chat with no measurable impact
// on answer relevance.
const QUOTE_CONTENT_CHAR_CAP = 800;
const CHUNK_CONTENT_CHAR_CAP = 600;

/**
 * Dynamic per-turn user message for project-chat. NEVER include
 * project-level metadata here — that lives in the (cached) system
 * prompt. Only retrieved evidence + the actual question go in here.
 */
export function chatUserPrompt(args: {
  question: string;
  quotations: { ref: string; content: string; document_title: string; codes: string[] }[];
  chunks: { ref: string; content: string; document_title: string }[];
}): string {
  const truncate = (s: string, cap: number) => {
    const collapsed = s.replace(/\s+/g, " ").trim();
    return collapsed.length > cap
      ? collapsed.slice(0, cap).trimEnd() + "…"
      : collapsed;
  };

  return `# Citas recuperadas
${
  args.quotations.length === 0
    ? "(ninguna)"
    : args.quotations
        .map(
          (q) =>
            `[${q.ref}] de "${q.document_title}" — códigos: ${q.codes.join(", ") || "ninguno"}\n  "${truncate(q.content, QUOTE_CONTENT_CHAR_CAP)}"`
        )
        .join("\n\n")
}

# Contexto recuperado de documentos
${
  args.chunks.length === 0
    ? "(ninguno)"
    : args.chunks
        .map((c) => `[${c.ref}] de "${c.document_title}"\n  "${truncate(c.content, CHUNK_CONTENT_CHAR_CAP)}"`)
        .join("\n\n")
}

# Pregunta
${args.question}

Responde fundamentando tu respuesta en el contexto recuperado anterior. Cita con [Q#] o [C#].`;
}
