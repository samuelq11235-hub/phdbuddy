import { supabase, STORAGE_BUCKET } from "./supabase";
import type {
  AISuggestion,
  CodebookSuggestionPayload,
  ChatMessage,
  CodeNetworkResponse,
  CooccurrenceResult,
  ExportFormat,
  FrequencyResult,
  KwicResult,
  QueryNode,
  SurveyImportMapping,
  ThemeSuggestionPayload,
} from "@/types/database";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let message = error.message ?? "Edge function error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === "function") {
      try {
        const text = await ctx.text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            message = text;
          }
        }
      } catch {
        /* ignore */
      }
    }
    throw new Error(message);
  }
  if (!data) throw new Error("Edge function returned no data");
  return data;
}

export const api = {
  processDocument(documentId: string) {
    return invoke<{ ok: true; documentId: string; chunkCount: number; pageCount: number | null; wordCount: number }>(
      "process-document",
      { documentId }
    );
  },

  autoCode(documentId: string) {
    return invoke<{ ok: true; suggestion: AISuggestion<CodebookSuggestionPayload> }>(
      "ai-auto-code",
      { documentId }
    );
  },

  applySuggestion(args: {
    suggestionId: string;
    acceptedCodeNames?: string[];
    acceptedQuotationIndices?: number[];
  }) {
    return invoke<{
      ok: true;
      insertedCodes: number;
      insertedQuotations: number;
      insertedCodings: number;
    }>("apply-suggestion", args);
  },

  suggestCodesForQuote(args: {
    quotationId?: string;
    projectId?: string;
    documentId?: string;
    text?: string;
    contextBefore?: string;
    contextAfter?: string;
  }) {
    return invoke<{
      ok: true;
      model: string;
      existing: { id: string; name: string; description: string | null; confidence: number; rationale?: string }[];
      new: { name: string; description: string | null; rationale?: string }[];
    }>("suggest-codes-for-quote", args);
  },

  clusterThemes(projectId: string, similarityThreshold?: number) {
    return invoke<{ ok: true; clusters: ThemeSuggestionPayload["clusters"]; model?: string }>(
      "cluster-themes",
      { projectId, similarityThreshold }
    );
  },

  embedQuotation(quotationId: string) {
    return invoke<{ ok: true }>("embed-quotation", { quotationId });
  },

  analyzeSentiment(args: {
    quotationIds?: string[];
    projectId?: string;
    limit?: number;
  }) {
    return invoke<{
      ok: true;
      analyzed: number;
      failed?: number;
      results: { quotationId: string; ok: boolean; label?: string; polarity?: number; error?: string }[];
    }>("analyze-sentiment", args);
  },

  chat(args: { projectId: string; sessionId?: string; question: string }) {
    return invoke<{ ok: true; sessionId: string; message: ChatMessage; model: string }>(
      "project-chat",
      args
    );
  },

  fetchCodeNetwork(args: {
    projectId: string;
    codeGroupId?: string | null;
    minWeight?: number;
    limitTopEdges?: number;
  }) {
    return invoke<CodeNetworkResponse>("code-network", args);
  },

  suggestRelations(args: { networkId: string; codeIds: string[] }) {
    return invoke<{
      ok: true;
      suggestionId: string;
      model: string;
      relations: {
        source_code_id: string;
        target_code_id: string;
        relation_type_name: string;
        rationale: string;
      }[];
    }>("suggest-relations", args);
  },

  sendInvitation(args: {
    projectId: string;
    email: string;
    role: "admin" | "coder" | "viewer";
    appOrigin?: string;
  }) {
    return invoke<{
      ok: true;
      invitationId: string;
      token: string;
      inviteUrl: string;
      email: string;
      role: string;
    }>("send-invitation", args);
  },

  acceptInvitation(args: { token: string }) {
    return invoke<{
      ok: true;
      projectId: string;
      projectName: string | null;
      role: "admin" | "coder" | "viewer";
    }>("accept-invitation", args);
  },

  exportProject(args: { projectId: string; format: ExportFormat }) {
    return invoke<{
      ok: true;
      jobId: string;
      format: string;
      signedUrl: string;
      expiresAt: string;
      storagePath: string;
      sizeBytes: number;
    }>("export-project", args);
  },

  executeQuery(args: { projectId: string; query: QueryNode }) {
    return invoke<{
      ok: true;
      quotationIds: string[];
      total: number;
      capped?: boolean;
    }>("execute-query", args);
  },

  computeAgreement(args: {
    projectId: string;
    userA: string;
    userB: string;
    documentIds?: string[];
  }) {
    return invoke<{
      ok: true;
      perCode: Array<{
        code_id: string;
        code_name: string;
        a_only: number;
        b_only: number;
        both: number;
        neither: number;
        kappa: number | null;
        percentAgreement: number;
      }>;
      global: {
        alpha: number | null;
        simpleAgreement: number | null;
        scottPi: number | null;
        holsti: number | null;
        kappa: number | null;
        n: number;
        bucketsPerDocument: number;
      };
      discrepancies: Array<{
        quotation_id: string;
        a_codes: string[];
        b_codes: string[];
      }>;
    }>("compute-agreement", args);
  },

  textFrequency(args: { projectId: string; topN?: number; documentIds?: string[] }) {
    return invoke<FrequencyResult>("analyze-text", { ...args, mode: "frequency" });
  },

  textKwic(args: {
    projectId: string;
    term: string;
    context?: number;
    caseSensitive?: boolean;
    documentIds?: string[];
  }) {
    return invoke<KwicResult>("analyze-text", { ...args, mode: "kwic" });
  },

  textCooccurrence(args: {
    projectId: string;
    scope?: "quotation" | "document";
    documentIds?: string[];
  }) {
    return invoke<CooccurrenceResult>("analyze-text", { ...args, mode: "cooccurrence" });
  },

};

// Survey CSV import — multipart/form-data, like importProject.
export async function importSurvey(args: {
  file: File;
  projectId?: string;
  newProjectName?: string;
  mapping: SurveyImportMapping;
}): Promise<{
  projectId: string;
  documentsCreated: number;
  rowsProcessed: number;
  groupId: string | null;
}> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("No autenticado");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const form = new FormData();
  form.append("file", args.file);
  form.append("mapping", JSON.stringify(args.mapping));
  if (args.projectId) {
    form.append("project", args.projectId);
  } else if (args.newProjectName) {
    form.append("newProject", "true");
    form.append("newProjectName", args.newProjectName);
  } else {
    throw new Error("Either projectId or newProjectName is required");
  }

  const resp = await fetch(`${supabaseUrl}/functions/v1/import-survey`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error((data as { error?: string }).error ?? "Survey import failed");
  return data;
}

// Import uses multipart/form-data — can't use the generic invoke() helper.
export async function importProject(file: File): Promise<{
  ok: true;
  projectId: string;
  projectName: string;
  imported: {
    codes: number;
    documents: number;
    quotations: number;
    codings: number;
    memos: number;
  };
}> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("No autenticado");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(`${supabaseUrl}/functions/v1/import-project`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error((data as { error?: string }).error ?? "Import failed");
  return data;
}

export async function uploadDocumentFile(
  userId: string,
  projectId: string,
  file: File
): Promise<{ storagePath: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${projectId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });

  if (error) throw new Error(error.message);
  return { storagePath };
}
