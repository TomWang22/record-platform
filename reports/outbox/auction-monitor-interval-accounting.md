# Auction-monitor interval accounting (attempt 4)

- **Status:** PASS — observed pending Δ == reconstructed pending Δ
- **Common interval (host):** `2026-08-05T21:52:38Z` → `2026-08-05T22:52:46Z` (3607.706s)
- **Common interval (db):** `2026-08-05 21:51:45.173787+00` → `2026-08-05 22:52:43.190073+00`
- **pending T0 → T1:** 7787489 → 7803359 (Δ **15870**)
- **total T0 → T1:** 8313503 → 8330123 (Δ **16620** = created, no-delete assumption)
- **published_true T0 → T1:** 526014 → 526764 (Δ **750** = net DB ack)
- **Reconstructed:** 16620 + 0 − 750 − 0 = **15870**
- **Match:** True
- **FIFO cohort:** oldest flipped 759/1000; mid flipped 0/200; missing 0
- **Broker ack:** NOT_OBSERVABLE_WITH_CURRENT_RUNTIME (do not equate DB ack with broker ack)
- **Negative ack rate accepted:** false
- **Created_at range COUNT:** skipped (Seq Scan timeout); total delta used

## Four rates (same interval)

| Rate | Value |
|------|-------|
| Configured selection ceiling | 750.0/h |
| Actual selection (oldest flips) | 757.3788/h |
| Broker ack | NOT_OBSERVABLE |
| Database ack (net published_true) | 748.398/h |
| Net pending change | 15836.1019/h |
| Insertion | 16584.5/h |
