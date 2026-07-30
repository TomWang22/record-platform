# T20.12U — Post–Tranche 8 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Tranche:** `t20-tranche-8` (+500 embeddings, 7,565 → 8,065; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **8,065** |
| Non-message chunks | 73,043 |
| Coverage | **≈11.0%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +1,935 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 8) |
|-------------|--------:|-------------------:|
| listing | 3,024 | +250 |
| listing_revision | 1,500 | +150 |
| notification | 1,150 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 8)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 11.0% / 8,065 — below 10k and 15% bars |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,544 total embedded OBO |
| Shadow p50/p95 (warm) | **CONDITIONAL** | 1,483 / 4,911 ms (T20.10T 20260625-212612) |
| Embed p50/p95 | **PASS** | 9 / 3,164 ms; 0 timeouts on eval run |
| Default/off chunk overlap | **DIAGNOSTIC** | 1/7 cases with chunk overlap > 0 |
| Flagged/on overlap | **DIAGNOSTIC** | 3/7 cases; flags reset 0/0 |
| Leakage | **PASS** | wrong_dim=0; transcript PASS |
| Keyword stability | **PASS** | 7/7 keyword cases non-empty |
| Tranche rerun guard | **PASS** | Tranche 2–8 locks block (exit 2) |
| Full validation bundle | **PASS** | contracts, smoke, runtime, provider, RP |

## Timing benchmark (warm)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-212612.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 1,483 / 4,911 |
| embed p50/p95 ms | 9 / 3,164 |
| candidate_fetch p50/p95 ms | 734 / 1,536 |
| embed timeouts | 0 |

## Live inference transcript

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-212838.md`

- Keyword: 7/7 non-empty, `rule-engine`, leakage PASS
- Default overlap: 1/7; flagged: 3/7; flags reset 0/0
- Structured endpoints: 5/6 (`buyer_collection_summary` HTTP 404 pre-existing)

## Model / provider evidence

| Path | Provider |
|------|----------|
| Production RAG | **rule-engine** (keyword) |
| Shadow diagnostics | **Ollama** (`nomic-embed-text`) |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next: **T20.12V** Tranche 9 dry-run. Actual write requires **T20.12W** approval.
