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
