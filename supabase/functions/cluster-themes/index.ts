// Edge Function: cluster-themes
// Cluster a project's quotations using their embeddings (greedy agglomerative
// clustering by cosine similarity), then ask Claude to label each cluster.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { callClaudeTool, CLAUDE_MODEL } from "../_shared/claude.ts";
import {
  THEME_CLUSTER_SYSTEM_PROMPT,
  themeClusterPrompt,
} from "../_shared/prompts.ts";

const THEME_TOOL_SCHEMA = {
  type: "object",
  required: ["themes"],
  properties: {
    themes: {
      type: "array",
      description: "Una etiqueta y descripción para cada cluster.",
      items: {
        type: "object",
        required: ["cluster_id", "label", "description"],
        properties: {
          cluster_id: {
            type: "string",
            description: "ID exacto del cluster (p. ej. 'cluster-1').",
          },
          label: {
            type: "string",
            description: "Tema corto (2-6 palabras) que describa el cluster.",
          },
          description: {
            type: "string",
            description: "Una sola oración explicando el tema.",
          },
          representative_quote_index: {
            type: "integer",
            description:
              "Índice (1-based) de la cita más representativa dentro del cluster.",
          },
        },
      },
    },
  },
};

interface RequestBody {
  projectId: string;
  similarityThreshold?: number;
  maxClusters?: number;
}

interface QuoteRow {
  id: string;
  document_id: string;
  content: string;
  embedding: number[];
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

  const { projectId, similarityThreshold = 0.55, maxClusters = 12 } = body;
  if (!projectId) return errorResponse("Missing projectId", 400);

  const supabase = getServiceClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, research_question")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (!project) return errorResponse("Project not found", 404);

  const { data: rawQuotes, error: qErr } = await supabase
    .from("quotations")
    .select("id, document_id, content, embedding")
    .eq("project_id", projectId)
    .not("embedding", "is", null);

  if (qErr) return errorResponse(qErr.message, 500);
  const quotes = (rawQuotes ?? []) as unknown as QuoteRow[];

  if (quotes.length < 2) {
    return jsonResponse({ ok: true, clusters: [], message: "Need at least 2 embedded quotations." });
  }

  // Normalize once.
  const norms = quotes.map((q) => normalize(q.embedding));

  // Greedy agglomerative-ish clustering: each quote joins the cluster whose
  // centroid is closest above the threshold; otherwise it spawns its own.
  const clusters: { centroid: number[]; members: number[] }[] = [];
  for (let i = 0; i < quotes.length; i++) {
    const vec = norms[i];
    let bestIdx = -1;
    let bestSim = similarityThreshold;
    for (let c = 0; c < clusters.length; c++) {
      const sim = cosine(vec, clusters[c].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = c;
      }
    }
    if (bestIdx === -1) {
      clusters.push({ centroid: vec.slice(), members: [i] });
    } else {
      clusters[bestIdx].members.push(i);
      clusters[bestIdx].centroid = updateCentroid(clusters[bestIdx], vec);
    }
  }

  // Discard tiny clusters (size 1) unless we'd have nothing left.
  const meaningful = clusters.filter((c) => c.members.length >= 2);
  const finalClusters =
    meaningful.length >= 2 ? meaningful : clusters.slice(0, Math.min(maxClusters, clusters.length));

  // Cap, sort by size desc.
  finalClusters.sort((a, b) => b.members.length - a.members.length);
  const trimmed = finalClusters.slice(0, maxClusters);

  // Build prompt-shaped clusters with up to 6 representative quotes each.
  const promptClusters = trimmed.map((c, idx) => ({
    id: `cluster-${idx + 1}`,
    quotes: c.members.slice(0, 6).map((m) => quotes[m].content),
  }));

  let labels: { themes?: { cluster_id: string; label: string; description: string; representative_quote_index?: number }[] } = {};
  let model: string = CLAUDE_MODEL;
  try {
    const r = await callClaudeTool<typeof labels>(
      [
        {
          role: "user",
          content: themeClusterPrompt({
            researchQuestion: project.research_question,
            clusters: promptClusters,
          }),
        },
      ],
      {
        system: THEME_CLUSTER_SYSTEM_PROMPT,
        toolName: "label_themes",
        toolDescription:
          "Devuelve una etiqueta y descripción para cada cluster identificado.",
        inputSchema: THEME_TOOL_SCHEMA,
        maxTokens: 4096,
        temperature: 0.2,
      }
    );
    labels = r.data;
    model = r.model;
  } catch (err) {
    console.warn("[cluster-themes] labeling failed:", err);
  }

  const labelsByCluster = new Map<string, { label: string; description: string; rep?: number }>();
  for (const t of labels.themes ?? []) {
    labelsByCluster.set(t.cluster_id, {
      label: t.label,
      description: t.description,
      rep: typeof t.representative_quote_index === "number"
        ? Math.max(0, t.representative_quote_index - 1)
        : undefined,
    });
  }

  const out = trimmed.map((c, idx) => {
    const id = `cluster-${idx + 1}`;
    const label = labelsByCluster.get(id);
    const repIndex = label?.rep ?? 0;
    const repMember = c.members[Math.min(repIndex, c.members.length - 1)];
    return {
      id,
      label: label?.label ?? `Theme ${idx + 1}`,
      description: label?.description ?? `Cluster of ${c.members.length} related quotations.`,
      size: c.members.length,
      quotation_ids: c.members.map((m) => quotes[m].id),
      representative_quote: quotes[repMember].content,
      representative_quotation_id: quotes[repMember].id,
    };
  });

  // Persist as ai_suggestions of kind="theme" for review/audit.
  await supabase.from("ai_suggestions").insert({
    user_id: userId,
    project_id: projectId,
    kind: "theme",
    payload: { clusters: out, threshold: similarityThreshold },
    status: "pending",
    model,
  });

  return jsonResponse({ ok: true, clusters: out, model });
});

function normalize(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function updateCentroid(cluster: { centroid: number[]; members: number[] }, addition: number[]): number[] {
  const n = cluster.members.length;
  const out = new Array(addition.length);
  for (let i = 0; i < addition.length; i++) {
    out[i] = (cluster.centroid[i] * (n - 1) + addition[i]) / n;
  }
  return normalize(out);
}
