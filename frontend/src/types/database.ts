// Hand-written DB row + Insert/Update types for the CAQDAS schema.
// Mirrors supabase/migrations/20260501020000_caqdas_pivot.sql.

export type DocumentStatus = "pending" | "processing" | "ready" | "error";

export type DocumentKind =
  | "interview"
  | "focus_group"
  | "field_notes"
  | "survey"
  | "literature"
  | "transcript"
  | "other"
  | "image"
  | "audio"
  | "video";

export type SelectionKind = "text" | "image_area" | "timerange";

export interface TextSelection {
  type: "text";
}
export interface ImageAreaSelection {
  type: "image_area";
  bbox: [number, number, number, number]; // x, y, w, h in image px
  page?: number;
}
export interface TimerangeSelection {
  type: "timerange";
  startMs: number;
  endMs: number;
}
export type SelectionMeta =
  | TextSelection
  | ImageAreaSelection
  | TimerangeSelection;

// =====================================================
// Boolean queries (F11)
// =====================================================
export type QueryNode =
  | { op: "and"; children: QueryNode[] }
  | { op: "or"; children: QueryNode[] }
  | { op: "not"; child: QueryNode }
  | { op: "code"; codeId: string }
  | { op: "document"; documentId: string }
  | { op: "sentiment"; label: "positive" | "negative" | "neutral" | "mixed" }
  | { op: "cooccurs"; a: string; b: string };

export interface SavedQuery {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  description: string | null;
  definition: QueryNode;
  created_at: string;
  updated_at: string;
}

export interface DocumentTranscriptSegment {
  id: string;
  document_id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
  created_at: string;
}

export type MemoType = "analytic" | "methodological" | "theoretical" | "reflective";

export type AISuggestionStatus = "pending" | "accepted" | "rejected" | "applied";
export type AISuggestionKind = "code" | "quotation" | "theme" | "codebook" | "relation";
export type ChatRole = "user" | "assistant" | "system";

export type LinkEntityType = "code" | "quotation" | "memo" | "document";

// =====================================================
// Profiles (kept from original)
// =====================================================
export interface Profile {
  id: string;
  full_name: string | null;
  institution: string | null;
  field_of_study: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// Projects
// =====================================================
export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  research_question: string | null;
  methodology: string | null;
  color: string;
  document_count: number;
  code_count: number;
  quotation_count: number;
  memo_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectInsert {
  name: string;
  description?: string | null;
  research_question?: string | null;
  methodology?: string | null;
  color?: string;
}

// =====================================================
// Documents
// =====================================================
export interface Document {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  kind: DocumentKind;
  source_metadata: Record<string, unknown>;
  storage_path: string | null;
  full_text: string | null;
  status: DocumentStatus;
  error_message: string | null;
  page_count: number | null;
  word_count: number | null;
  quotation_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentInsert {
  user_id: string;
  project_id: string;
  title: string;
  kind?: DocumentKind;
  source_metadata?: Record<string, unknown>;
  storage_path?: string | null;
  full_text?: string | null;
  status?: DocumentStatus;
}

// =====================================================
// Document chunks
// =====================================================
export interface DocumentChunk {
  id: string;
  document_id: string;
  project_id: string;
  chunk_index: number;
  content: string;
  start_offset: number | null;
  end_offset: number | null;
  tokens: number | null;
  embedding: number[] | null;
  created_at: string;
}

// =====================================================
// Codes
// =====================================================
export interface Code {
  id: string;
  user_id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  color: string;
  created_by_ai: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface CodeInsert {
  user_id: string;
  project_id: string;
  parent_id?: string | null;
  name: string;
  description?: string | null;
  color?: string;
  created_by_ai?: boolean;
}

// =====================================================
// Code groups (transversal grouping of codes; m2m)
// =====================================================
export interface CodeGroup {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface CodeGroupInsert {
  user_id: string;
  project_id: string;
  name: string;
  description?: string | null;
  color?: string;
}

export interface CodeGroupMember {
  code_id: string;
  code_group_id: string;
  user_id: string;
  created_at: string;
}

// =====================================================
// Quotations
// =====================================================
export interface Quotation {
  id: string;
  user_id: string;
  project_id: string;
  document_id: string;
  start_offset: number | null;
  end_offset: number | null;
  content: string;
  comment: string | null;
  selection_meta: SelectionMeta;
  embedding: number[] | null;
  created_by_ai: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuotationInsert {
  user_id: string;
  project_id: string;
  document_id: string;
  start_offset: number;
  end_offset: number;
  content: string;
  comment?: string | null;
  created_by_ai?: boolean;
}

// =====================================================
// quotation_codes (m2m)
// =====================================================
export interface QuotationCode {
  quotation_id: string;
  code_id: string;
  user_id: string;
  created_by_ai: boolean;
  ai_confidence: number | null;
  created_at: string;
}

// Useful joined shape returned by selects with `codes(*)`.
export interface QuotationWithCodes extends Quotation {
  quotation_codes?: { code: Code; created_by_ai: boolean; ai_confidence: number | null }[];
  document?: Pick<Document, "id" | "title" | "kind">;
}

// =====================================================
// Memos
// =====================================================
export interface Memo {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  content: string;
  kind: MemoType;
  linked_code_ids: string[];
  linked_quotation_ids: string[];
  linked_document_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface MemoInsert {
  user_id: string;
  project_id: string;
  title: string;
  content?: string;
  kind?: MemoType;
  linked_code_ids?: string[];
  linked_quotation_ids?: string[];
  linked_document_ids?: string[];
}

// =====================================================
// AI suggestions
// =====================================================
export interface AISuggestion<P = unknown> {
  id: string;
  user_id: string;
  project_id: string;
  document_id: string | null;
  kind: AISuggestionKind;
  payload: P;
  status: AISuggestionStatus;
  model: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface CodebookSuggestionPayload {
  summary: string;
  codes: { name: string; description?: string; color?: string }[];
  quotations: {
    start_offset: number;
    end_offset: number;
    content: string;
    rationale?: string;
    code_names: string[];
    confidence?: number;
  }[];
  truncated?: boolean;
  source_chars?: number;
  full_chars?: number;
  chunks?: number;
  // Background job lifecycle. When true the suggestion row is a
  // placeholder created by ai-auto-code while Claude is still working.
  // The frontend polls until this flips to false.
  processing?: boolean;
  // Filled in when the background job crashed (rate limit, timeout,
  // schema error). UI offers a retry CTA.
  error?: string;
  rate_limited?: boolean;
  started_at?: string;
  progress?: {
    stage: "queued" | "codebook" | "quotations" | string;
    chunks_done: number;
    chunks_total: number;
    waiting_ms?: number;
  };
  // True when codebook generation (pass-1) was rate-limited and we
  // reused the project's existing codes instead of generating new ones.
  codebook_fallback?: boolean;
  // Number of chunks in pass-2 that hit the Anthropic rate limit.
  rate_limited_chunks?: number;
}

export interface ThemeSuggestionPayload {
  clusters: {
    id: string;
    label: string;
    description: string;
    size: number;
    quotation_ids: string[];
    representative_quote: string;
    representative_quotation_id: string;
  }[];
  threshold: number;
}

// =====================================================
// Chat
// =====================================================
export interface ChatSession {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatCitation {
  type: "quotation" | "chunk";
  id: string;
  document_id: string;
  document_title?: string;
  content: string;
  similarity: number;
  ref?: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  citations: ChatCitation[];
  created_at: string;
}

// =====================================================
// Code co-occurrence (RPC return shape)
// =====================================================
export interface CodeCooccurrenceRow {
  code_a: string;
  code_b: string;
  occurrences: number;
}

// =====================================================
// Code-Document matrix (RPC return shape)
// =====================================================
export interface CodeDocumentMatrixRow {
  code_id: string;
  document_id: string;
  count: number;
}

// =====================================================
// Quotation sentiment (F3)
// =====================================================
export type SentimentLabel = "positive" | "negative" | "neutral" | "mixed";

export interface SentimentAspect {
  aspect: string;
  polarity: number;
}

export interface QuotationSentiment {
  quotation_id: string;
  user_id: string;
  project_id: string;
  polarity: number;
  label: SentimentLabel;
  aspects: SentimentAspect[];
  emotions: string[];
  model: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// Networks (F4 — editable diagram)
// =====================================================
export interface NetworkLayout {
  // Map of "<entity_type>:<entity_id>" → { x, y } pixel coordinates.
  [nodeKey: string]: { x: number; y: number };
}

export interface Network {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  description: string | null;
  layout: NetworkLayout;
  created_at: string;
  updated_at: string;
}

export interface RelationType {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string;
  is_symmetric: boolean;
  is_seed: boolean;
  created_at: string;
}

export interface Link {
  id: string;
  user_id: string;
  project_id: string;
  network_id: string;
  source_type: LinkEntityType;
  source_id: string;
  target_type: LinkEntityType;
  target_id: string;
  relation_type_id: string | null;
  comment: string | null;
  created_at: string;
}

export interface RelationSuggestionPayload {
  network_id: string;
  relations: {
    source_code_id: string;
    target_code_id: string;
    relation_type_name: string;
    rationale: string;
  }[];
}

// =====================================================
// Code Co-occurrence Network (edge function code-network)
// =====================================================
export interface CodeNetworkNode {
  id: string;
  label: string;
  size: number;
  color: string;
  parent_id: string | null;
}

export interface CodeNetworkEdge {
  source: string;
  target: string;
  weight: number;
}

export interface CodeNetworkResponse {
  ok: true;
  projectId: string;
  generatedAt: string;
  stats: { nodeCount: number; edgeCount: number; totalQuotations: number };
  nodes: CodeNetworkNode[];
  edges: CodeNetworkEdge[];
  notice?: string;
}

// =====================================================
// Shared quotations between two codes (RPC return shape)
// =====================================================
export interface SharedQuotationRow {
  quotation_id: string;
  document_id: string;
  document_title: string;
  start_offset: number;
  end_offset: number;
  content: string;
  comment: string | null;
  created_at: string;
}

// =====================================================
// Documents linked to a code (RPC return shape)
// =====================================================
export interface DocumentForCodeRow {
  document_id: string;
  document_title: string;
  document_kind: DocumentKind;
  quotation_count: number;
  last_quoted_at: string | null;
}

// =====================================================
// F6 — Exports / Imports
// =====================================================
export type ExportFormat = "csv" | "markdown" | "qdaxml" | "html";
export type ExportJobStatus = "pending" | "done" | "error";

export interface ExportJob {
  id: string;
  project_id: string;
  user_id: string;
  format: ExportFormat;
  status: ExportJobStatus;
  storage_path: string | null;
  signed_url: string | null;
  signed_url_expires_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// F5 — Multi-user collaboration
// =====================================================
export type ProjectRole = "owner" | "admin" | "coder" | "viewer";

// Roles assignable via invitation (everything except owner — which can
// only be minted via project creation or a future transfer flow).
export type InvitableRole = Exclude<ProjectRole, "owner">;

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
  updated_at: string;
}

// Convenience shape returned by the members panel — joins profile fields
// from `profiles` so the UI can show a name + avatar without a second
// round-trip.
export interface ProjectMemberWithProfile extends ProjectMember {
  profile: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
  email: string | null;
}

export interface ProjectInvitation {
  id: string;
  project_id: string;
  email: string;
  role: InvitableRole;
  token: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// Row shape of the my_projects_with_role() RPC — extends Project with
// the caller's role, so the projects list can render role-aware actions.
export interface ProjectWithRole extends Project {
  role: ProjectRole;
}

// =====================================================
// F12 — Quotation hyperlinks
// =====================================================
export interface QuotationLink {
  id: string;
  user_id: string;
  project_id: string;
  from_quotation_id: string;
  to_quotation_id: string;
  relation_type_id: string | null;
  comment: string | null;
  created_at: string;
}

// Convenience shape returned by hooks that want to render the link with
// the relation type name + the target quotation snippet without doing
// extra fetches in the component.
export interface QuotationLinkWithContext extends QuotationLink {
  relation_type_name: string | null;
  relation_type_color: string | null;
  to_content: string;
  to_document_title: string;
}

// =====================================================
// F13 — Text analysis (frequency / KWIC / cooccurrence)
// =====================================================
export interface FrequencyResult {
  totalTokens: number;
  uniqueTerms: number;
  documentsAnalyzed: number;
  terms: Array<{ term: string; count: number; documentFrequency: number }>;
}

export interface KwicMatch {
  documentId: string;
  documentTitle: string;
  offset: number;
  left: string;
  match: string;
  right: string;
}
export interface KwicResult {
  term: string;
  context: number;
  caseSensitive: boolean;
  capped: boolean;
  matches: KwicMatch[];
}

export interface CooccurrenceResult {
  scope: "quotation" | "document";
  codes: Array<{ id: string; name: string; color: string; count: number }>;
  matrix: Array<{ a: string; b: string; count: number }>;
}

// =====================================================
// F14 — Document groups + attribute schema
// =====================================================
export interface DocumentGroup {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  smart_filter: unknown | null;
  created_at: string;
  updated_at: string;
}
export interface DocumentGroupMember {
  document_group_id: string;
  document_id: string;
  added_at: string;
}
export type AttributeDataType = "text" | "number" | "date" | "choice";
export interface DocumentAttributeSchema {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  data_type: AttributeDataType;
  options: string[] | null;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

// =====================================================
// F15 — Survey importer (frontend mapping config)
// =====================================================
export interface SurveyImportMapping {
  idColumn?: string;
  contentColumns: string[];
  attributeColumns: string[];
  groupName?: string;
  skipEmpty?: boolean;
}
