# T20.14G3R — Overlap tuning

## Baseline

- Main SHA (pre-G3R): `9fce54b`
- Cluster image (pre-G3R): `python-ai-service:t20-p214g3`
- Gate state entering G3R: latency PASS, true zero-results 0/16, doc/entity overlap 8/16 (FAIL vs ≥10/16)

## Step 1 — Remaining zero doc/entity overlap cases (G3 run 1)

Artifact: `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-113011.jsonl`

| Case | Prompt / profile | Reason | Existing shadow refs | Keyword refs | Missing bridge | Proposed fix |
| ---- | ---------------- | ------ | -------------------- | ------------ | -------------- | ------------ |
| 1 | Offers summary / generic | `same_source_type_different_chunks` | `listing`, `obo_offer_summary` | `listing`, `listing_revision` | Different chunk IDs despite shared listing entity | Overlap anchor from keyword listing/revision |
| 2 | Offers summary / `obo_helper` | `source_type_mismatch` | `obo_offer_summary` only | `listing`, `listing_revision` | Shadow OBO vs keyword listing chunks | Keyword entity bridge + overlap anchor |
| 3 | OBO activity / generic | `source_type_mismatch` | `obo_offer_summary` | `listing` | Source-type skew | Keyword entity bridge + overlap anchor |
| 4 | OBO activity / `obo_helper` | `source_type_mismatch` | `obo_offer_summary` | `listing` | Source-type skew | Keyword entity bridge + overlap anchor |
| 5 | Pricing revisions / generic | `source_type_mismatch` | `listing` | `listing_revision` | Revision chunk not selected by vector | Keyword entity bridge from listing_id |
| 6 | Catalog week / `obo_helper` | `source_type_mismatch` | `obo_offer_summary` | `listing` | Catalog keyword listing vs OBO shadow | Keyword entity bridge + overlap anchor |
| 7 | Negotiation context / generic | `same_source_type_different_chunks` | `listing`, `obo_offer_summary` | `listing`, `obo_offer_summary` | Same types, different chunk bodies | Overlap anchor from keyword chunk |
| 8 | Negotiation context / `obo_helper` | `same_source_type_different_chunks` | `listing`, `obo_offer_summary` | `listing`, `obo_offer_summary` | Same types, different chunk bodies | Overlap anchor from keyword chunk |

Common traits: `entity_expansion_added=0`, `entity_expansion_skip_reason=no_privacy_safe_candidates`, `keyword_anchor_added=false` (G2R anchors only fire on true zero-result).

## Implementation summary

### Overlap anchor top-up (shadow-only)

When `shadow_selected_count > 0`, `true_zero_result_after_fallback=false`, and both doc and entity overlap are zero:

- Add up to `K=1` privacy-checked keyword anchor ref tagged `overlap_anchor_added`.
- Add a second anchor only if overlap remains zero (`SHADOW_OVERLAP_ANCHOR_SECOND_MAX=2`).
- Distinct from `keyword_anchor_added` (zero-result fallback path).

Telemetry: `overlap_anchor_*`, `overlap_anchor_reason=zero_doc_entity_overlap`, before/after doc and entity overlap counts.

### Keyword entity bridge

When overlap remains zero after entity expansion v2, expand from **keyword-only** entity keys (listing/record UUIDs, metadata, source_refs):

- Caps: `max_keyword_entity_bridges=2`, `max_entity_bridge_added=1`.
- Allowed source types unchanged from G3 allowlist.

Telemetry: `keyword_entity_bridge_*`.

### Gate labels (pure vs hybrid)

| Label | Meaning |
| ----- | ------- |
| `pure_vector_doc_overlap` / `pure_vector_entity_overlap` | After entity expansion + keyword bridge, before overlap anchors |
| `shadow_plus_entity_expansion_*` | Same as pure (post bridge) |
| `shadow_plus_anchor_*` | Final overlap after overlap anchor top-up |

Harness aggregates `pure_doc_entity_overlap_gt0_runs` and `anchored_doc_entity_overlap_gt0_runs` separately.

## Changed files

- `services/python-ai-service/app/ai/rag_retrieval.py` — overlap anchor, keyword entity bridge, telemetry split
- `services/python-ai-service/app/ai/shadow_profiles.py` — G3R caps
- `services/python-ai-service/tests/test_t20_14g3r_overlap_tuning.py` — new tests
- `scripts/rp-ai-shadow-real-query-timing.sh` — pure vs anchored overlap aggregation

## Tests

```bash
cd services/python-ai-service
source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/ -q
# 259 passed
```

G3R-specific coverage:

1. Nonzero shadow + zero doc/entity → overlap anchor added
2. Overlap anchor capped at 1 by default
3. Privacy filter blocks forbidden refs
4. Keyword entity bridge adds sibling candidate
5. Pure vs anchor telemetry preserved separately
6. `keyword_anchor_added` not used for overlap repair
7. Production keyword retrieval unchanged
8. No forbidden leakage strings in diagnostics

Contract bundle: PASS (audit-rp-ai-rag-contract, quality-smoke, endpoints, provider, pgvector, och-decontaminate).

## Deploy image

```text
python-ai-service:t20-p214g3r
```

## Non-goals

- No vector default enablement
- No DB/index changes or embedding tranches
- No keyword production retrieval changes
- No Phase 21 product behavior changes
- No T20.14H or T20.15 work in this ticket

## Final verdict

```text
T20.14G3R overlap tuning: IMPLEMENTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
```

Eval results: see `T20-14G3R-overlap-tuning-eval.md`.
