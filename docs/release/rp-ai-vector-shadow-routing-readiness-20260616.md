# Record Platform AI vector shadow routing readiness — Phase 19 lock

Generated: 2026-06-16  
Edge: `https://record-platform.test` (strict TLS only)

## Release identity

| Field | Value |
|-------|-------|
| Final SHA (T19.7) | `b86162ca0a2b18403b340c551c8e0fec1586fe5f` |
| Closeout lock | This commit (`chore(ai): lock vector shadow routing readiness proof`) |
| Phase | **19 — vector shadow routing readiness (locked)** |
| Phase 20 | **Not started** |
| Prepared tag (not created unless asked) | `rp-ai-vector-shadow-routing-20260616` |

## Phase 19 proof chain

| Ticket | Scope | Status |
|--------|-------|--------|
| **T19.3** | Tranche 1 embedded staged sample (controlled; not full backfill) | Green |
| **T19.4** | Global vector shadow source surfacing diagnostic | Green |
| **T19.5** | Route-specific shadow source_type weights (opt-in) | Green |
| **T19.6** | Route-specific shadow query hints + OBO visibility diagnostic | Green |
| **T19.7** | Owner-visible OBO corpus repair (real offers + targeted embed) | Green |

**Locked behavior:** keyword retrieval remains production default; vector retrieval is shadow/diagnostic only; broad Tranche 2 and full corpus backfill **not started**.

## Embedded corpus (closeout snapshot)

| source_type | embedded chunks |
|-------------|----------------:|
| listing | 1,500 |
| listing_revision | 700 |
| notification | 700 |
| obo_offer_summary | 802 |
| record | 594 |
| auction_bid_summary | 253 |
| **Total embedded** | **4,549** |

Full corpus backfill: **not started** (majority of chunks remain keyword-only / unembedded).

## Owner-visible OBO repair proof (T19.7)

| Metric | Value |
|--------|------:|
| Root cause | `missing_source_offers` for `e2e-contract@record-platform.local` |
| Repair | Real API OBO flow (listing + offer + counter) + targeted reindex |
| `e2e-contract` owner-visible embedded OBO | **2** |
| Global embedded `obo_offer_summary` | 802 |
| Ingestion path | `rp-ai-rag-reindex.sh --source offers --user <uuid>` only |
| Embedding path | `rp-ai-embed-obo-owner-visible.sh` (e2e scope default) |

Scripts: `scripts/rp-ai-obo-corpus-rca.sh`, `scripts/rp-ai-obo-source-repair.sh`, `scripts/rp-ai-embed-obo-owner-visible.sh`.

## Route-specific shadow profiles (T19.5)

Opt-in via `?shadow_vector=1&shadow_profile=<name>` on `/api/ai/rag/query`.

| Profile | Preferred source types |
|---------|------------------------|
| `auction_risk` | auction_bid_summary, listing, listing_revision, notification |
| `obo_helper` / `pricing_recommendation` | obo_offer_summary, listing, listing_revision, record |
| `record_valuation` / `buyer_collection_summary` | record, listing, notification |
| `seller_sales_summary` | listing, listing_revision, obo_offer_summary, auction_bid_summary, notification |
| `generic_rag` | all allowed types |

Unknown profiles fall back to `generic_rag`. Keyword response and `source_refs` unchanged when shadow enabled.

Implementation: `services/python-ai-service/app/ai/shadow_profiles.py`, `retrieve_chunks_vector_shadow()` in `rag_retrieval.py`.

## Query hint behavior (T19.6)

Opt-in via `?shadow_query_hints=1` (shadow mode only). Hints expand the **embedding query** only; keyword path uses the original question.

Diagnostics include: `query_hint_applied`, `expanded_query_terms`, `top_results` (labels/source_ids only).

| Profile | Hint terms (summary) |
|---------|----------------------|
| `auction_risk` | bid history, reserve, ending soon, proxy pressure, listing revision |
| `obo_helper` | offer, counter, fair price, listing price, buyer, seller |
| `record_valuation` | record, artist, condition, collection, valuation |
| `seller_sales_summary` | seller, sold, revenue, notification, performance |
| `generic_rag` | mild marketplace hints only |

## Privacy guarantees (locked)

1. Owner scope first (`visibility` + `owner_user_id`) before route weights or hints
2. No `message` docs unless `metadata.opt_in=true`
3. No proxy max in corpus or responses (`max_bid_cents`, `proxy_bids`)
4. No private OBO message bodies in corpus (metadata-only OBO summaries)
5. Shadow diagnostics only — never alters production `summary`, `source_refs`, or ranking
6. Route weights and query hints apply **only** when `shadow_vector=1`

## Retrieval mode

| Setting | Value |
|---------|-------|
| Production default | **`keyword`** |
| Vector retrieval default | **off** |
| Shadow vector | **opt-in only** (`AI_RAG_SHADOW_VECTOR=1` or `?shadow_vector=1`) |
| Shadow alters response | **no** — diagnostics in `details.shadow_vector` only |
| Broad Tranche 2 | **not started** |
| Phase 20 | **not started** |

## Operational scripts

| Script | Purpose |
|--------|---------|
| `scripts/rp-ai-shadow-source-diagnostic.sh` | Unweighted vs weighted vs weighted+hints shadow quality |
| `scripts/rp-ai-vector-distribution-audit.sh` | Embedded distribution by source_type |
| `scripts/rp-ai-obo-corpus-rca.sh` | Read-only OBO corpus RCA for contract users |
| `scripts/rp-ai-obo-source-repair.sh` | Real OBO API repair + targeted reindex |
| `scripts/rp-ai-embed-obo-owner-visible.sh` | Targeted OBO embedding (contract user scope) |
| `scripts/rp-ai-rag-shadow-smoke.sh` | Shadow vs keyword smoke |
| `scripts/audit-rp-ai-rag-contract.sh` | RAG contract + shadow profile/hint assertions |

## Rollback commands

**Do not run unless explicitly approving rollback.**

1. **Disable shadow vector (no DB change):**

   ```bash
   kubectl -n record-platform set env deploy/python-ai-service AI_RAG_SHADOW_VECTOR=0
   kubectl -n record-platform rollout status deploy/python-ai-service
   ```

2. **Revert python-ai to pre-T19.5 SHA** (`61ff382` parent chain) — removes route profiles/hints; keyword unchanged.

3. **Clear vector embeddings only (keeps chunks + keyword path):**

   ```sql
   UPDATE ai.ai_document_chunks
   SET embedding_vec = NULL,
       embedding_status = 'pending',
       embedding_model = NULL,
       embedding_updated_at = NULL
   WHERE embedding_vec IS NOT NULL;
   ```

4. **Restore python_ai from backup:**

   ```bash
   # Use manifest in backups/rp-all-11-t19-vector-shadow-routing-lock/
   # pg_restore -h 127.0.0.1 -p 5440 -U postgres -d python_ai --clean --if-exists <5440-python-ai.dump>
   ```

## Phase 20 boundary

Phase 20 (production vector retrieval rollout or broad Tranche 2 full corpus backfill) is **not started**. Do not enable vector as default retrieval without explicit approval.

## Gate bundle (P19-CLOSE-2)

```bash
pnpm install --frozen-lockfile
bash scripts/rp-ai-vector-distribution-audit.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/rp-ai-obo-corpus-rca.sh
bash scripts/rp-ai-rag-shadow-smoke.sh
bash scripts/rp-ai-analytics-output-validation.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-bootstrap-grpc-mtls-gate.sh
bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh
bash scripts/smoke-rp-mtls-real.sh
bash scripts/audit-rp-redis-lua-runtime-contract.sh
bash scripts/audit-rp-event-outbox-contract.sh
bash scripts/rp-runtime-domain-comb.sh
bash scripts/rp-db-domain-comb.sh
bash scripts/rp-rp-decontaminate-scan.sh
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
```
