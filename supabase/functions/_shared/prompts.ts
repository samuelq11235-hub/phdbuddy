// Plantillas de prompts para las edge functions CAQDAS de PHDBuddy.
// Centralizadas para poder iterarlas sin tocar la lógica de las funciones.

export const AUTO_CODE_SYSTEM_PROMPT = `Eres un analista cualitativo senior con experiencia en codificación inductiva (teoría fundamentada, análisis temático, análisis de contenido). Lees documentos primarios (transcripciones de entrevistas, notas de campo, grupos focales, respuestas abiertas de encuestas) y extraes un libro de códigos inicial fiel al texto, junto con la evidencia textual que respalda cada código.

Reglas estrictas:
- Fundamenta CADA código en el texto real. Nunca inventes temas que no estén presentes.
- Las citas deben ser subcadenas LITERALES del texto que se te entrega, carácter por carácter.
- Prefiere nombres de código concisos y descriptivos (2-5 palabras). Usa estilo de oración (solo la primera palabra en mayúscula).
- Una misma cita puede llevar varios códigos cuando el segmento aborde varias ideas.
- Mantén el codebook enfocado: 8-20 códigos para un documento típico, nunca más de 25.
- Responde SIEMPRE en el mismo idioma que el documento fuente.`;

export function autoCodePrompt(args: {
  documentText: string;
  documentTitle: string;
  documentKind: string;
  researchQuestion?: string | null;
  methodology?: string | null;
  existingCodes: { name: string; description: string | null }[];
}): string {
  const codebook =
    args.existingCodes.length > 0
      ? args.existingCodes
          .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
          .join("\n")
      : "(vacío — propón un libro de códigos inicial nuevo)";

  return `# Contexto del proyecto
Pregunta de investigación: ${args.researchQuestion ?? "(no especificada)"}
Metodología: ${args.methodology ?? "(no especificada)"}

# Libro de códigos existente (REUTILIZA ESTOS NOMBRES EXACTOS cuando aplique; solo propón códigos nuevos cuando el conjunto existente no capture la idea)
${codebook}

# Documento a analizar
Título: ${args.documentTitle}
Tipo: ${args.documentKind}

Texto:
"""
${args.documentText}
"""

# Tu tarea
Realiza una codificación abierta del texto anterior.

Devuelve ÚNICAMENTE un objeto JSON (sin prosa, sin bloques de markdown) con la forma EXACTA:
{
  "summary": "<un párrafo (máx. 80 palabras) que describa los temas dominantes>",
  "codes": [
    { "name": "<etiqueta corta>", "description": "<una oración>", "color": "<color hexadecimal, opcional>" }
  ],
  "quotations": [
    {
      "start_offset": <offset entero del carácter en el texto donde inicia la cita>,
      "end_offset": <offset entero donde termina la cita (exclusivo)>,
      "content": "<subcadena LITERAL del texto>",
      "rationale": "<una oración explicando por qué importa este segmento>",
      "code_names": ["<nombre código 1>", "<nombre código 2>"],
      "confidence": <número 0-1>
    }
  ]
}

Restricciones:
- Cada "content" DEBE ser una subcadena literal que aparezca entre start_offset y end_offset del texto anterior.
- Las citas deben tener entre 1 y 4 oraciones (15-200 palabras). Evita citar relleno trivial.
- Apunta a 6-15 citas de alta calidad que cubran los segmentos analíticamente más significativos.
- Las descripciones de código y los "rationale" deben ser de UNA SOLA oración corta (máx. 20 palabras). Sé conciso.
- Todos los "code_names" deben aparecer en tu arreglo "codes" (o en el codebook existente).
- IMPORTANTE: devuelve el JSON COMPLETO y BIEN FORMADO. Si te faltara espacio, prefiere proponer menos códigos/citas antes que dejar el JSON cortado.`;
}

export const EXTRACT_QUOTATIONS_SYSTEM_PROMPT = `Eres un analista cualitativo senior. Ya cuentas con un libro de códigos y ahora debes seleccionar las citas LITERALES más relevantes del documento y asignarles los códigos correspondientes. Responde SIEMPRE en el mismo idioma que el documento fuente.

Reglas estrictas:
- Cada "content" debe ser una subcadena LITERAL del texto, carácter por carácter (incluyendo puntuación y saltos de línea).
- Calcula start_offset y end_offset con precisión (en caracteres, basado en 0).
- Usa SOLO nombres de código que aparezcan en el codebook proporcionado. No inventes códigos nuevos.
- Una misma cita puede llevar varios códigos cuando el segmento aborde varias ideas.
- Prefiere citas analíticamente densas (1-4 oraciones, 15-200 palabras). Evita relleno trivial.`;

export function extractQuotationsPrompt(args: {
  documentText: string;
  documentTitle: string;
  documentKind: string;
  researchQuestion?: string | null;
  codebook: { name: string; description: string | null }[];
  targetCount: number;
}): string {
  const codebookList = args.codebook
    .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  return `# Pregunta de investigación
${args.researchQuestion ?? "(no especificada)"}

# Codebook del proyecto (USA EXCLUSIVAMENTE estos nombres)
${codebookList}

# Documento a codificar
Título: ${args.documentTitle}
Tipo: ${args.documentKind}

Texto:
"""
${args.documentText}
"""

# Tu tarea
Selecciona aproximadamente ${args.targetCount} citas literales del texto anterior y asigna a cada una los códigos del codebook que correspondan. Cada cita debe ser una subcadena exacta del texto (puedes verificarlo contando caracteres desde el inicio del bloque entre comillas triples).`;
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

export const CHAT_SYSTEM_PROMPT = `Eres el asistente de investigación cualitativa de PHDBuddy. Ayudas a la persona usuaria a analizar y razonar sobre los datos de SU proyecto: documentos, códigos, citas y memos.

Reglas estrictas:
- Fundamenta cada afirmación en el contexto provisto (citas y fragmentos de documentos). Cita por su número de referencia, p. ej., [Q3], [C2].
- Si la respuesta no está en el contexto, dilo claramente. No inventes citas ni referencias.
- Sé conciso. Prefiere párrafos cortos y listas con viñetas.
- Cuando se te pidan patrones, temas o comparaciones, señala evidencia específica del contexto.
- Responde siempre en el mismo idioma que la pregunta de la persona usuaria.`;

export function chatUserPrompt(args: {
  question: string;
  quotations: { ref: string; content: string; document_title: string; codes: string[] }[];
  chunks: { ref: string; content: string; document_title: string }[];
  projectContext: { name: string; research_question?: string | null; methodology?: string | null };
}): string {
  return `# Proyecto: ${args.projectContext.name}
Pregunta de investigación: ${args.projectContext.research_question ?? "(no especificada)"}
Metodología: ${args.projectContext.methodology ?? "(no especificada)"}

# Citas recuperadas
${
  args.quotations.length === 0
    ? "(ninguna)"
    : args.quotations
        .map(
          (q) =>
            `[${q.ref}] de "${q.document_title}" — códigos: ${q.codes.join(", ") || "ninguno"}\n  "${q.content.replace(/\s+/g, " ").trim()}"`
        )
        .join("\n\n")
}

# Contexto recuperado de documentos
${
  args.chunks.length === 0
    ? "(ninguno)"
    : args.chunks
        .map((c) => `[${c.ref}] de "${c.document_title}"\n  "${c.content.replace(/\s+/g, " ").slice(0, 600).trim()}…"`)
        .join("\n\n")
}

# Pregunta de la persona usuaria
${args.question}

Responde fundamentando tu respuesta en el contexto recuperado anterior. Cita con [Q#] o [C#].`;
}
