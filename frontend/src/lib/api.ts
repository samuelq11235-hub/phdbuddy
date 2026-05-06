import { supabase, STORAGE_BUCKET } from "./supabase";
import type {
  AISuggestion,
  CodebookSuggestionPayload,
  ChatMessage,
  CodeNetworkResponse,
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
};

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
