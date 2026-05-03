import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { api, uploadDocumentFile } from "@/lib/api";
import type { Document, DocumentKind } from "@/types/database";

export function useDocuments(projectId: string | undefined) {
  return useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Document[];
    },
    enabled: !!projectId,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Document | null;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const status = (query.state.data as Document | null)?.status;
      return status === "pending" || status === "processing" ? 2500 : false;
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      projectId,
      file,
      title,
      kind,
    }: {
      projectId: string;
      file: File;
      title?: string;
      kind?: DocumentKind;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { storagePath } = await uploadDocumentFile(user.id, projectId, file);
      const { data, error } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          project_id: projectId,
          title: title?.trim() || file.name.replace(/\.[^.]+$/, ""),
          kind: kind ?? "other",
          storage_path: storagePath,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw error;
      const doc = data as Document;
      // Fire-and-forget: extraction + embedding can take minutes when
      // Voyage's free tier throttles us. The DB row already says
      // status="pending" and useDocument() polls until it flips to
      // "ready" or "error" (in which case error_message is populated).
      api.processDocument(doc.id).catch((err) => {
        console.warn("[upload] background processDocument failed:", err);
      });
      return doc;
    },
    onSuccess: (_doc, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", vars.projectId] });
    },
  });
}

export function useCreateInlineDocument() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      projectId,
      title,
      text,
      kind,
    }: {
      projectId: string;
      title: string;
      text: string;
      kind?: DocumentKind;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          project_id: projectId,
          title: title.trim(),
          kind: kind ?? "other",
          full_text: text,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw error;
      const doc = data as Document;
      // Fire-and-forget: see useUploadDocument for rationale.
      api.processDocument(doc.id).catch((err) => {
        console.warn("[inline] background processDocument failed:", err);
      });
      return doc;
    },
    onSuccess: (_doc, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", vars.projectId] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doc: Pick<Document, "id" | "storage_path" | "project_id">) => {
      if (doc.storage_path) {
        await supabase.storage.from("documents").remove([doc.storage_path]);
      }
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents", doc.project_id] });
    },
  });
}

export function useReprocessDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      // Mark the document as pending again so the polling badge shows
      // progress immediately while the (potentially slow) re-embedding
      // runs in the background.
      await supabase
        .from("documents")
        .update({ status: "pending", error_message: null })
        .eq("id", documentId);
      api.processDocument(documentId).catch((err) => {
        console.warn("[reprocess] background processDocument failed:", err);
      });
      return { documentId };
    },
    onSuccess: (_data, documentId) => {
      qc.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });
}
