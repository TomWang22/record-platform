/**
 * T15.2B — Analytics owns normalization/cleaning of platform signals for the AI corpus.
 *
 * Deterministic export logic lives in `scripts/lib/rp-ai-normalize-documents.mjs` (shared with
 * `scripts/rp-ai-rag-reindex.mjs`). analytics-service HTTP export endpoints will call the same
 * normalizers in a later ticket; reindex invokes them directly today.
 *
 * Rules enforced at export:
 * - owner-scoped visibility; no cross-user private content
 * - OBO/auction summaries only (no raw negotiation, no proxy max)
 * - messages only when auth.users.settings.ai_rag_message_opt_in = true
 */
export const AI_NORMALIZE_EXPORT_VERSION = 't15.2b';

export type AiNormalizedDocument = {
  source_type: string;
  source_id: string;
  owner_user_id: string | null;
  visibility: 'owner' | 'public' | 'private';
  title: string;
  summary: string;
  normalized_text: string;
  source_updated_at: string;
  checksum: string;
  metadata: Record<string, unknown>;
  source_refs: Array<{ schema: string; table: string; id: string }>;
};
