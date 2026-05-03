// Shared types for the CAQDAS edge functions.

export type DocumentStatus = "pending" | "processing" | "ready" | "error";

export type DocumentKind =
  | "interview"
  | "focus_group"
  | "field_notes"
  | "survey"
  | "literature"
  | "transcript"
  | "other";

export interface SuggestedCode {
  name: string;
  description?: string;
  color?: string;
}

export interface SuggestedQuotation {
  start_offset: number;
  end_offset: number;
  content: string;
  rationale?: string;
  code_names: string[];
  confidence?: number;
}

export interface AutoCodePayload {
  codes: SuggestedCode[];
  quotations: SuggestedQuotation[];
  summary: string;
}

export interface ThemeCluster {
  label: string;
  description: string;
  quotation_ids: string[];
  representative_quote: string;
}

export interface ChatCitation {
  type: "quotation" | "chunk";
  id: string;
  document_id: string;
  document_title?: string;
  content: string;
  similarity: number;
}
