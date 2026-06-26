# T20.12AC — Post–Tranche 10 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Tranche:** `t20-tranche-10` (+500 embeddings, 8,565 → 9,065; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **9,065** |
| Non-message chunks | 73,043 |
| Coverage | **≈12.4%** |
| Gap to 10k | +935 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 10) |
|-------------|--------:|-------------------:|
| listing | 3,524 | +250 |
| listing_revision | 1,800 | +150 |
| notification | 1,350 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 10)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 12.4% / 9,065 — below 10k and 15% bars |
| Source diversity | **PASS** | 6 types |
| Owner-visible OBO | **PASS** | 18 / 1,544 |
| Shadow p50/p95 (warm eval) | **CONDITIONAL** | 2,214 / **9,282 ms**; 2 embed timeouts |
| Shadow p95 (pre-write gate) | **CONDITIONAL** | **4,020 ms** |
| Leakage | **PASS** | transcript PASS; wrong_dim=0 |
| Keyword stability | **PASS** | 7/7 keyword cases |
| Tranche rerun guard | **PASS** | Tranche 2–10 locks block |
| Full validation bundle | **PASS** | |

**Latency:** Shadow p95 remains **CONDITIONAL** and **rollout-blocking** (target ≤3,000 ms). Does not block embedding ladder.

## Timing (warm eval)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-233057.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 2,214 / 9,282 |
| embed p50/p95 ms | 15 / 5,474 |
| embed timeouts | 2 |
| zero-overlap shadow runs | 11/16 |

## Live inference transcript

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-233619.md`

- Keyword: 7/7 non-empty, `rule-engine`, leakage PASS
- Default overlap: 0/7; flagged: 2/7; flags reset 0/0
- Structured endpoints: 5/6 (`buyer_collection_summary` HTTP 404 pre-existing)

## Finish-to-10k ladder

| Tranche | Projected embedded | Gap to 10k |
|---------|-------------------:|-----------:|
| After AE (11) | 9,565 | +435 |
| After AI (12) | 10,065 | **≥10k gate clears** |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next: **T20.12AD** dry-run complete. Actual write requires **T20.12AE** approval.
