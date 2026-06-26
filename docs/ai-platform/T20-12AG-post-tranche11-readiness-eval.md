# T20.12AG — Post–Tranche 11 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-26  
**Tranche:** `t20-tranche-11` (+500 embeddings, 9,065 → 9,565; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **9,565** |
| Non-message chunks | 73,043 |
| Coverage | **≈13.1%** |
| Gap to 10k | +435 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 11) |
|-------------|--------:|-------------------:|
| listing | 3,774 | +250 |
| listing_revision | 1,950 | +150 |
| notification | 1,450 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 11)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 13.1% / 9,565 — below 10k and 15% bars |
| Source diversity | **PASS** | 6 types |
| Owner-visible OBO | **PASS** | 18 / 1,544 |
| Shadow p50/p95 (warm eval) | **CONDITIONAL** | 3,182 / **4,956 ms**; 0 embed timeouts |
| Shadow p95 (pre-write gate) | **CONDITIONAL** | **3,413 ms** |
| Leakage | **PASS** | transcript PASS; wrong_dim=0 |
| Keyword stability | **PASS** | 7/7 keyword cases |
| Tranche rerun guard | **PASS** | Tranche 2–11 locks block |
| Full validation bundle | **PASS** | |

**Latency:** Shadow p95 remains **CONDITIONAL** and **rollout-blocking** (target ≤3,000 ms). Does not block embedding ladder.

## Timing (warm eval)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-100351.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 3,182 / 4,956 |
| embed p50/p95 ms | 890 / 3,567 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 16/16 |

## Live inference transcript

Artifact (local): `bench_logs/ai-platform/live-inference/20260626-100351.md`

- Keyword: 7/7 non-empty, `rule-engine`, leakage PASS
- Default overlap: 1/7; flagged: 1/7; flags reset 0/0
- Structured endpoints: 5/6 (`buyer_collection_summary` HTTP 404 pre-existing)
- Shadow-off: 1 embed timeout on `catalog_activity`

## Finish-to-10k ladder

| Tranche | Projected embedded | Gap to 10k |
|---------|-------------------:|-----------:|
| After AI (12) | 10,065 | **≥10k gate clears** |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next: **T20.12AH** dry-run complete. Actual write requires **T20.12AI** approval.
