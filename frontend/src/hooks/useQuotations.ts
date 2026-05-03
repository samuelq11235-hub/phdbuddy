import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { Code, Quotation } from "@/types/database";

export interface QuotationWithCodes extends Quotation {
  codes: Code[];
  document_title?: string;
}

interface RawCodingRow {
  code: Code | Code[] | null;
}

function unwrapCodes(rows: RawCodingRow[] | null | undefined): Code[] {
  if (!rows) return [];
  return rows.flatMap((r) => (Array.isArray(r.code) ? r.code : r.code ? [r.code] : []));
}

export function useQuotations(projectId: string | undefined, opts?: { codeId?: string; documentId?: string }) {
  return useQuery({
    queryKey: ["quotations", projectId, opts?.codeId, opts?.documentId],
    queryFn: async () => {
      if (!projectId) return [];

      let query = supabase
        .from("quotations")
        .select(
          `id, project_id, document_id, start_offset, end_offset, content, comment, created_by_ai, created_at, updated_at, user_id, embedding,
           document:documents(title),
           coding:quotation_codes(code:codes(*))`
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (opts?.documentId) query = query.eq("document_id", opts.documentId);
      if (opts?.codeId) {
        const { data: links, error: lErr } = await supabase
          .from("quotation_codes")
          .select("quotation_id")
          .eq("code_id", opts.codeId);
        if (lErr) throw lErr;
        const ids = (links ?? []).map((l: { quotation_id: string }) => l.quotation_id);
        if (ids.length === 0) return [];
        query = query.in("id", ids);
      }

      const { data, error } = await query;
      if (error) throw error;

      type Row = Quotation & {
        document: { title: string } | { title: string }[] | null;
        coding: RawCodingRow[] | null;
      };
      return (data ?? []).map((row) => {
        const r = row as Row;
        const doc = Array.isArray(r.document) ? r.document[0] : r.document;
        return {
          ...r,
          codes: unwrapCodes(r.coding),
          document_title: doc?.title,
        } as QuotationWithCodes;
      });
    },
    enabled: !!projectId,
  });
}

export function useQuotation(quotationId: string | undefined) {
  return useQuery({
    queryKey: ["quotation", quotationId],
    queryFn: async () => {
      if (!quotationId) return null;
      const { data, error } = await supabase
        .from("quotations")
        .select(
          `*,
           document:documents(title),
           coding:quotation_codes(code:codes(*))`
        )
        .eq("id", quotationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as Quotation & {
        document: { title: string } | { title: string }[] | null;
        coding: RawCodingRow[] | null;
      };
      const doc = Array.isArray(r.document) ? r.document[0] : r.document;
      return { ...r, codes: unwrapCodes(r.coding), document_title: doc?.title } as QuotationWithCodes;
    },
    enabled: !!quotationId,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      documentId: string;
      startOffset: number;
      endOffset: number;
      content: string;
      comment?: string;
      codeIds?: string[];
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      const { data, error } = await supabase
        .from("quotations")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          document_id: input.documentId,
          start_offset: input.startOffset,
          end_offset: input.endOffset,
          content: input.content,
          comment: input.comment ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const quote = data as Quotation;

      if (input.codeIds && input.codeIds.length > 0) {
        const { error: cErr } = await supabase.from("quotation_codes").insert(
          input.codeIds.map((codeId) => ({
            quotation_id: quote.id,
            code_id: codeId,
            user_id: user.id,
          }))
        );
        if (cErr) throw cErr;
      }

      // Fire-and-forget embed; don't block the UI on it.
      void api.embedQuotation(quote.id).catch((err) =>
        console.warn("embed-quotation failed", err)
      );

      return quote;
    },
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ["quotations", quote.project_id] });
      qc.invalidateQueries({ queryKey: ["document-quotations", quote.document_id] });
    },
  });
}

export function useUpdateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      comment?: string | null;
      content?: string;
    }) => {
      const { data, error } = await supabase
        .from("quotations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Quotation;
    },
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ["quotations", quote.project_id] });
      qc.invalidateQueries({ queryKey: ["quotation", quote.id] });
    },
  });
}

export function useDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quote: Pick<Quotation, "id" | "project_id" | "document_id">) => {
      const { error } = await supabase.from("quotations").delete().eq("id", quote.id);
      if (error) throw error;
      return quote;
    },
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ["quotations", quote.project_id] });
      qc.invalidateQueries({ queryKey: ["document-quotations", quote.document_id] });
    },
  });
}

export function useToggleCoding() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      quotationId,
      codeId,
      attach,
    }: {
      quotationId: string;
      codeId: string;
      attach: boolean;
    }) => {
      if (!user) throw new Error("No has iniciado sesión");
      if (attach) {
        const { error } = await supabase
          .from("quotation_codes")
          .insert({ quotation_id: quotationId, code_id: codeId, user_id: user.id });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("quotation_codes")
          .delete()
          .eq("quotation_id", quotationId)
          .eq("code_id", codeId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["quotation"] });
      qc.invalidateQueries({ queryKey: ["codes"] });
    },
  });
}

export function useDocumentQuotations(documentId: string | undefined) {
  return useQuery({
    queryKey: ["document-quotations", documentId],
    queryFn: async () => {
      if (!documentId) return [];
      const { data, error } = await supabase
        .from("quotations")
        .select(`*, coding:quotation_codes(code:codes(*))`)
        .eq("document_id", documentId)
        .order("start_offset", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as Quotation & { coding: RawCodingRow[] | null };
        return { ...r, codes: unwrapCodes(r.coding) } as QuotationWithCodes;
      });
    },
    enabled: !!documentId,
  });
}
