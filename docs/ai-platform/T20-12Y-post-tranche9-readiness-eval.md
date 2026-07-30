# T20.12Y — Post–Tranche 9 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Tranche:** `t20-tranche-9` (+500 embeddings, 8,065 → 8,565; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **8,565** |
| Non-message chunks | 73,043 |
| Coverage | **≈11.7%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +1,435 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 9) |
|-------------|--------:|-------------------:|
| listing | 3,274 | +250 |
| listing_revision | 1,650 | +150 |
| notification | 1,250 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 9)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 11.7% / 8,565 — below 10k and 15% bars |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,544 total embedded OBO |
| Shadow p50/p95 (warm eval) | **CONDITIONAL** | 1,093 / **4,728 ms** (T20.10T 20260625-223227) |
| Shadow p95 (pre-write gate) | **CONDITIONAL** | **9,694 ms** on pre-write timing run — elevated; ladder continues |
| Embed p50/p95 | **PASS** | 9 / 1,997 ms; 0 timeouts on eval run |
| Default/off chunk overlap | **DIAGNOSTIC** | 1/7 cases with chunk overlap > 0 |
| Flagged/on overlap | **DIAGNOSTIC** | 3/7 cases; flags reset 0/0 |
| Leakage | **PASS** | wrong_dim=0; transcript PASS |
| Keyword stability | **PASS** | 7/7 keyword cases non-empty |
| Tranche rerun guard | **PASS** | Tranche 2–9 locks block (exit 2) |
| Full validation bundle | **PASS** | contracts, smoke, runtime, provider, RP |

**Latency note:** Shadow p95 remains **CONDITIONAL** and **rollout-blocking** (target ≤3,000 ms). This does not block the embedding ladder; it blocks vector rollout and Phase 21.

### Shadow source diagnostic (T19.6C)

**RESULT: PASS (0 issues)** — 6 types; OBO owner-visible 18 / 1,544.

## Timing benchmark (warm eval)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-223227.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 1,093 / 4,728 |
| embed p50/p95 ms | 9 / 1,997 |
| candidate_fetch p50/p95 ms | 525 / 2,539 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 11/16 |

## Live inference transcript

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-223531.md`

- Keyword: 7/7 non-empty, `rule-engine`, leakage PASS
- Default overlap: 1/7; flagged: 3/7; flags reset 0/0
- Structured endpoints: 5/6 (`buyer_collection_summary` HTTP 404 pre-existing)

## Model / provider evidence

| Path | Provider |
|------|----------|
| Production RAG | **rule-engine** (keyword) |
| Shadow diagnostics | **Ollama** (`nomic-embed-text`) |

## Finish-to-10k ladder (remaining)

| Tranche | Projected embedded | Gap to 10k |
|---------|-------------------:|-----------:|
| After AA (10) | 9,065 | +935 |
| After AE (11) | 9,565 | +435 |
| After AI (12) | 10,065 | **≥10k gate clears** |

At 10,065: run **T20.13** comprehensive rollout readiness before Phase 21 or T20.14/T20.15.

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next: **T20.12Z** Tranche 10 dry-run. Actual write requires **T20.12AA** approval.
