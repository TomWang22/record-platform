# T20.12AK — Post–Tranche 12 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-26  
**Tranche:** `t20-tranche-12` (+500 embeddings, 9,565 → 10,065; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **10,065** |
| Non-message chunks | 73,043 |
| Coverage | **≈13.8%** |
| ≥10k count gate | **PASS** |
| ≥15% coverage gate | **FAIL** |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 12) |
|-------------|--------:|-------------------:|
| listing | 4,024 | +250 |
| listing_revision | 2,100 | +150 |
| notification | 1,550 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 12)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded count (≥10k) | **PASS** | 10,065 |
| Embedded coverage (≥15%) | **FAIL** | 13.8% |
| Source diversity | **PASS** | 6 embedded types; shadow weighted 5 when prompts succeed |
| Owner-visible OBO | **PASS** | 18 / 1,544 |
| Shadow p50/p95 (warm eval) | **FAIL** | 3,248 / **6,457 ms** |
| Shadow p95 (pre-write gate) | **CONDITIONAL** | **2,925 ms** (near SLO) |
| Embed p95 / timeouts | **CONDITIONAL** | eval 3,297 ms; 1 live-inference embed timeout |
| Leakage | **PASS** | transcript PASS; wrong_dim=0 |
| Keyword stability | **PASS** | 7/7 keyword cases |
| Default/off overlap | **FAIL** | 15/16 zero (timing); 1/7 live inference |
| Flagged overlap | **FAIL** (diagnostic) | 3/7 live inference — improved but not rollout |
| Zero-result shadow runs | **FAIL** | 8/16 |
| Tranche rerun guard | **PASS** | Tranche 2–12 locks block |
| Full validation bundle | **PASS** | contracts/smokes/OCH; post-write source diagnostic had transient request failures |

## Timing (warm eval)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-125154.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 3,248 / 6,457 |
| embed p50/p95 ms | 1,938 / 3,297 |
| embed timeouts | 0 (timing harness) |
| zero-overlap shadow runs | 15/16 |
| zero-result shadow runs | 8/16 |

## Live inference transcript

Artifact (local): `bench_logs/ai-platform/live-inference/20260626-125155.md`  
Raw JSON: `bench_logs/ai-platform/live-inference/raw-20260626-125155`

- Keyword: 7/7 non-empty, `rule-engine`, leakage PASS
- Default overlap: 1/7; flagged: 3/7; flags reset 0/0
- Structured endpoints: 5/6 (`buyer_collection_summary` HTTP 404 pre-existing)
- Shadow-off: 1 embed timeout on `catalog_activity`

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next: **T20.13** comprehensive vector rollout readiness re-eval (required before any rollout or Phase 21).
