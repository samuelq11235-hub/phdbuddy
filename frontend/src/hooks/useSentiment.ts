import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { QuotationSentiment, SentimentLabel } from "@/types/database";

/**
 * Loads all sentiment rows for a project. The list tends to be small
 * (one row per analyzed quotation), so we keep them in memory and key
 * them by `quotation_id` for O(1) lookup from quotation cards/panels.
 */
export function useQuotationSentiments(projectId: string | undefined) {
  return useQuery({
    queryKey: ["quotation-sentiments", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("quotation_sentiment")
        .select("*")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as QuotationSentiment[];
    },
    enabled: !!projectId,
  });
}

export function useQuotationSentimentMap(
  projectId: string | undefined
): Map<string, QuotationSentiment> {
  const { data } = useQuotationSentiments(projectId);
  return useMemo(() => {
    const m = new Map<string, QuotationSentiment>();
    for (const s of data ?? []) m.set(s.quotation_id, s);
    return m;
  }, [data]);
}

export function useAnalyzeSentiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      projectId: string;
      quotationIds?: string[];
      limit?: number;
    }) => {
      return api.analyzeSentiment({
        quotationIds: args.quotationIds,
        projectId: args.projectId,
        limit: args.limit,
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["quotation-sentiments", vars.projectId] });
    },
  });
}

// =====================================================
// Display helpers
// =====================================================

const SENTIMENT_COLORS: Record<SentimentLabel, string> = {
  positive: "#10B981",
  negative: "#EF4444",
  neutral: "#94A3B8",
  mixed: "#F59E0B",
};

const SENTIMENT_LABELS_ES: Record<SentimentLabel, string> = {
  positive: "Positivo",
  negative: "Negativo",
  neutral: "Neutro",
  mixed: "Mixto",
};

export function sentimentColor(label: SentimentLabel): string {
  return SENTIMENT_COLORS[label];
}

export function sentimentLabelEs(label: SentimentLabel): string {
  return SENTIMENT_LABELS_ES[label];
}
