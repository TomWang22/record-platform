# T20.10D — Owner-visible OBO corpus/index repair

**Status:** repair script + runbook (not a vector rollout ticket)  
**Mode:** targeted source repair + reindex + owner-visible embed only

## Why this ticket exists

T20.10A benchmark showed the OBO owner-visible rollout blocker is **corpus depth**, not privacy filtering:

| Signal | Value |
|--------|------:|
| raw `obo_offer_summary` (owner OBO prompt) | 2 |
| selected `obo_offer_summary` | 2 |
| `blocked_owner_scope_count` | 0 |
| privacy_filter p95 | ~7 ms |

Vector retrieval cannot surface owner-visible OBO context that is not present in the candidate pool.

## Root cause (confirmed)

For `e2e-contract@record-platform.local`:

1. **Source data gap** — only a small number of seller-side rows in `listings.offers` (benchmark baseline: 2).
2. **Ingestion is working** — `normalizeOboOfferSummary` in `scripts/lib/rp-ai-normalize-documents.mjs` creates one owner doc per role (buyer + seller) per offer with `visibility=owner`.
3. **Reindex path is working** — `exportOffers` in `scripts/rp-ai-rag-reindex.mjs` ingests offers filtered by user.
4. **Embedding path is working** — `scripts/rp-ai-embed-obo-owner-visible.sh` embeds unembedded owner OBO chunks for contract users.

The gap was **not enough seller offers for the contract user**, not broken visibility metadata or privacy filters.

## Hard rules

- keyword retrieval stays production default
- vector stays shadow-only
- no broad/full backfill
- no `EMBEDDING_BACKFILL_FORCE=1`
- no Tranche 2 rerun
- no Phase 21

## Repair procedure

```bash
git rev-parse HEAD

# 1) Read-only RCA
bash scripts/rp-ai-obo-corpus-rca.sh

# 2) Targeted repair (seeds real OBO flows if seller offers < target, then reindex + embed)
TARGET_SELLER_OFFERS=10 bash scripts/rp-ai-t20-obo-owner-visible-repair.sh

# 3) Re-benchmark
bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh

# 4) Gates
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/rp-rp-decontaminate-scan.sh
```

## Proof SQL (contract seller)

```sql
-- seller offers in source DB (listings:5435)
SELECT count(*) FROM listings.offers WHERE seller_user_id = '<e2e-uid>';

-- owner-visible OBO docs
SELECT count(*) FROM ai.ai_documents
WHERE source_type = 'obo_offer_summary' AND owner_user_id = '<e2e-uid>';

-- embedded owner-visible OBO chunks
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type = 'obo_offer_summary'
  AND d.owner_user_id = '<e2e-uid>'
  AND c.embedding_vec IS NOT NULL;
```

## Acceptance criteria

- seller offers for e2e-contract ≥ 10 (or documented target)
- owner-visible embedded OBO chunks ≥ 10 for e2e-contract
- T20.10A benchmark raw `obo_offer_summary` > 2 on owner OBO prompts
- `blocked_owner_scope_count` remains low
- keyword behavior unchanged
- no leakage regressions
- coverage ≥ 90% on `app/ai/*`

## After repair

1. Re-run `scripts/rp-ai-shadow-real-query-timing.sh`
2. If raw OBO depth improved but p95 latency still high → **T20.10C profile narrowing**
3. Do **not** start T20.9 tranche 3 until OBO depth + latency gates improve

## After repair benchmark (2026-06-22)

Artifacts: `bench_logs/ai-platform/t20-10-shadow-real-query-20260622-152217.jsonl`

| Metric | Pre-repair | Post-repair |
|--------|----------:|------------:|
| e2e embedded obo chunks | 2 | **18** |
| shadow total p95 | 9322 ms | **3541 ms** |
| embed p95 | 5433 ms | 1615 ms |
| candidate_fetch p95 | 3611 ms | 2282 ms |
| OBO owner prompt raw `obo_offer_summary` | 2 | **8** |
| OBO owner prompt selected `obo_offer_summary` | 2 | 2 |
| zero-overlap shadow runs | 11/15 | 12/16 |

Corpus depth target (≥10 embedded owner-visible OBO) is **met**. Selection still caps OBO at 2 on the owner prompt despite raw pool of 8 → **T20.10C** next for profile/ranking narrowing. Latency improved but p95 still above 3s rollout target.

## Files

| File | Purpose |
|------|---------|
| `scripts/rp-ai-t20-obo-owner-visible-repair.sh` | Targeted repair orchestration |
| `scripts/rp-ai-obo-corpus-rca.sh` | Read-only RCA |
| `scripts/rp-ai-obo-source-repair.sh` | T19.7B minimal flow (first offer only) |
| `scripts/lib/rp-ai-normalize-documents.mjs` | OBO summary generation |
| `scripts/rp-ai-rag-reindex.mjs` | Offer export + ingest |
| `scripts/rp-ai-embed-obo-owner-visible.sh` | Targeted OBO embedding |
