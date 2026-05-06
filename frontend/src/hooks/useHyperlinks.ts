import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { QuotationLink, QuotationLinkWithContext } from "@/types/database";

// All hyperlinks (in + out) for a single quotation, with the join data
// needed to render them — relation type label/color and the snippet of
// the *other* quotation. Two queries + JS join because the relation_types
// FK is nullable so the embed isn't always reliable.
export function useQuotationLinks(quotationId: string | undefined) {
  return useQuery({
    queryKey: ["quotation-links", quotationId],
    queryFn: async (): Promise<QuotationLinkWithContext[]> => {
      if (!quotationId) return [];
      const { data: links, error } = await supabase
        .from("quotation_links")
        .select("id, user_id, project_id, from_quotation_id, to_quotation_id, relation_type_id, comment, created_at")
        .or(`from_quotation_id.eq.${quotationId},to_quotation_id.eq.${quotationId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (links ?? []) as QuotationLink[];
      if (rows.length === 0) return [];

      const otherIds = Array.from(
        new Set(
          rows.map((l) => (l.from_quotation_id === quotationId ? l.to_quotation_id : l.from_quotation_id))
        )
      );
      const relationIds = Array.from(
        new Set(rows.map((l) => l.relation_type_id).filter((x): x is string => !!x))
      );

      const [{ data: quotas }, { data: relations }] = await Promise.all([
        supabase
          .from("quotations")
          .select("id, content, document_id")
          .in("id", otherIds),
        relationIds.length > 0
          ? supabase
              .from("relation_types")
              .select("id, name, color")
              .in("id", relationIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string; color: string }> }),
      ]);
      const quoteRows = (quotas ?? []) as Array<{ id: string; content: string; document_id: string }>;
      const docIds = Array.from(new Set(quoteRows.map((q) => q.document_id)));
      const { data: docs } = docIds.length
        ? await supabase.from("documents").select("id, title").in("id", docIds)
        : { data: [] };

      const quoteById = new Map(quoteRows.map((q) => [q.id, q]));
      const docById = new Map((docs ?? []).map((d: { id: string; title: string }) => [d.id, d]));
      const relById = new Map(
        ((relations ?? []) as Array<{ id: string; name: string; color: string }>).map((r) => [r.id, r])
      );

      return rows.map((l) => {
        const otherId = l.from_quotation_id === quotationId ? l.to_quotation_id : l.from_quotation_id;
        const other = quoteById.get(otherId);
        const rel = l.relation_type_id ? relById.get(l.relation_type_id) : null;
        return {
          ...l,
          relation_type_name: rel?.name ?? null,
          relation_type_color: rel?.color ?? null,
          to_content: other?.content ?? "",
          to_document_title: other ? docById.get(other.document_id)?.title ?? "" : "",
        };
      });
    },
    enabled: !!quotationId,
  });
}

export function useCreateQuotationLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      fromQuotationId: string;
      toQuotationId: string;
      relationTypeId?: string | null;
      comment?: string | null;
    }): Promise<QuotationLink> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("quotation_links")
        .insert({
          user_id: user.id,
          project_id: input.projectId,
          from_quotation_id: input.fromQuotationId,
          to_quotation_id: input.toQuotationId,
          relation_type_id: input.relationTypeId ?? null,
          comment: input.comment ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as QuotationLink;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["quotation-links", link.from_quotation_id] });
      qc.invalidateQueries({ queryKey: ["quotation-links", link.to_quotation_id] });
    },
  });
}

export function useDeleteQuotationLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: Pick<QuotationLink, "id" | "from_quotation_id" | "to_quotation_id">) => {
      const { error } = await supabase.from("quotation_links").delete().eq("id", link.id);
      if (error) throw error;
      return link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["quotation-links", link.from_quotation_id] });
      qc.invalidateQueries({ queryKey: ["quotation-links", link.to_quotation_id] });
    },
  });
}
