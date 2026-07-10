# T20.10G — Shadow ranking / overlap alignment

**Generated:** 2026-06-22  
**Baseline SHA:** `88726ba840630c81b5ee0a21025c9c2c3b31360f` (post T20.9 results doc)  
**Mode:** shadow-only diagnostics — no vector default flip, no keyword changes

## Executive summary

Added shadow-only overlap explanation diagnostics: document-level overlap, entity overlap (listing/offer/record keys), and zero-overlap reason classification. Benchmark summary script aggregates the new fields. **Vector rollout remains NOT APPROVED.**

| Gate | Status |
|------|--------|
| Coverage | **FAIL** — 7.62% |
| Overlap / parity | **FAIL** — 12/16 zero chunk overlap (unchanged pre-deploy) |
| Latency | **borderline / regressed on this run** — p95 9062 ms (embed outlier; T20.9 post was ~3010 ms) |
| OBO owner-visible | **PASS** — 18 embedded |
| Leakage | **PASS** |
| Keyword stability | **PASS** |
| Tranche lock | **PASS** |

## Why overlap alignment is next

Post-T20.9, keyword and shadow paths often return **zero shared chunk ids** (12/16 benchmark prompts) even when both paths retrieve relevant seller context. Chunk-id overlap is a strict metric; document, source-type, and entity overlap explain whether paths disagree on *which* chunks vs *which* topics/listings.

## Implementation (shadow-only)

### A. Overlap explanation in `shadow_diagnostics.overlap`

When shadow debug runs compare keyword vs shadow selections, the API now includes:

```json
{
  "overlap": {
    "count": 0,
    "document_overlap_count": 1,
    "entity_overlap_count": 2,
    "explanation": {
      "keyword_source_types": {"listing": 5, "listing_revision": 3},
      "shadow_source_types": {"obo_offer_summary": 6, "listing": 2},
      "chunk_overlap_count": 0,
      "document_overlap_count": 1,
      "entity_overlap_count": 2,
      "shared_source_type_count": 1,
      "zero_overlap_reason": "shared_entity_different_chunks"
    }
  }
}
```

No private body text is included — only ids, source types, and safe metadata keys.

### B. Zero-overlap reason taxonomy

| Reason | Meaning |
|--------|---------|
| `shared_entity_different_chunks` | Same listing/offer/record entity, different chunk ids |
| `same_document_different_chunks` | Same document_id, different chunks |
| `source_type_mismatch` | No shared source types between paths |
| `same_source_type_different_chunks` | Shared types but no shared docs/entities |
| `different_retrieval_paths` | Fallback when paths diverge without clear doc/entity link |
| `one_path_empty` | Keyword or shadow returned no chunks |

### C. Benchmark summary (`rp-ai-shadow-real-query-timing.sh`)

Aggregate section now reports:

- zero-overlap shadow runs (chunk)
- document-overlap >0 runs
- entity-overlap >0 runs
- zero-overlap reason counts

Per-run table adds: `chunk_ov`, `doc_ov`, `entity_ov`, `reason`.

## Before / after metrics

### Before (T20.9 post-run, deployed service)

| Metric | Value |
|--------|------:|
| Zero chunk overlap | **12/16** |
| Shadow p50 / p95 | 1635 / **3010 ms** |
| Embed p95 | 1887 ms |
| Owner OBO embedded | 18 |

Document/entity overlap and reason breakdown were **not available** (pre-T20.10G API).

### After code (local tests + pre-deploy benchmark)

| Metric | Value | Notes |
|--------|------:|-------|
| Unit tests | **111 passed**, 91.65% line cov | overlap explanation covered |
| Zero chunk overlap | **12/16** | unchanged — ranking not tuned yet |
| Document overlap >0 | **0/16** | API fields empty until python-ai redeploy |
| Entity overlap >0 | **0/16** | same |
| Zero-overlap reasons | **unknown: 12** | cluster still on pre-T20.10G build |
| Shadow p50 / p95 | 4254 / **9062 ms** | embed outlier on OBO owner prompt (6479 ms) |
| Owner OBO selected (live) | 8 per shadow run | contract gate on embedded count still 18 |

**Interpretation:** Diagnostics are implemented and tested locally. Live overlap explanation requires redeploying `python-ai-service` with this commit. Zero-overlap *count* was not expected to improve in this ticket without shadow ranking tuning (deferred until reason breakdown is visible post-deploy).

## Validation

| Check | Result |
|-------|--------|
| `run-service-coverage.sh python-ai-service` | **PASS** — 111 tests, 91.65% |
| RAG contract | **PASS** |
| OCH decontaminate scan | **PASS** |
| Keyword behavior | **unchanged** |
| Vector default | **shadow-only** |

Full post-deploy validation bundle (after redeploy):

```bash
bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

## Rollout verdict

**Vector retrieval default: NOT APPROVED.**

T20.10G improves *diagnostics* for overlap failure analysis. It does not clear coverage or overlap gates. No new embedding tranche. No Phase 21.

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | document/entity overlap + reason classification |
| `services/python-ai-service/tests/test_shadow_diagnostics.py` | overlap explanation tests |
| `scripts/rp-ai-shadow-real-query-timing.sh` | aggregate doc/entity/reason columns |

## Next steps (post-deploy)

1. Redeploy `python-ai-service` with T20.10G code.
2. Re-run shadow benchmark; capture zero-overlap reason distribution.
3. If reasons show `same_source_type_different_chunks` or `source_type_mismatch`, tune shadow profiles only (listing/OBO alignment) — still no keyword changes.
4. Re-evaluate overlap gate; vector default remains blocked until coverage ≥15% or ≥10k and overlap materially improves.
