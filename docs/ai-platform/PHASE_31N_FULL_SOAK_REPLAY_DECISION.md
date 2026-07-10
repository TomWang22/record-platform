# Phase 31N — Full Soak Replay Decision

## Decision

**Decision: B — rerun full repaired 51,840 soak**

## Reason

31M proves the repair on affected windows, users, and protocols, but the production-enablement decision requires full long-soak evidence under the repaired shared preview window coordinator. Targeted replay alone is insufficient for 31E–31J closeout.

## Prerequisites

| Gate | Status |
|------|--------|
| Phase 31M targeted replay (3672/3672) | Required PASS |
| Phase 31M gates clean (`wrong_gate=0`, `fallback=0`, `leakage=0`) | Required |

## Next action: Phase 31D-R2

Full repaired staging long-soak replay:

| Parameter | Value |
|-----------|-------|
| Target | **51,840 / 51,840** |
| HTTP/1.1 | 17,280 / 17,280 |
| HTTP/2 | 17,280 / 17,280 |
| HTTP/3 | 17,280 / 17,280 |
| Coordinator | Repaired shared preview window coordinator (`windowSequence`) |
| Production enablement | **NOT APPROVED** |
| Production default change | **NO** |
| PERCENT rollout | **NO** |
| Generated reports committed | **NO** |

## Closeout gate

Only after **31D-R2 PASS** may Phase 31E–31J (pipeline failure injection, KPI report, latency regression, disable switch rollback, go/no-go, production enablement archive) run.

## Hard stops (unchanged)

- Production enablement: **NOT APPROVED**
- Production default: `keyword`
- PERCENT: `0`
- ALLOW_PROD_PERCENT: `0`
- Hybrid/vector production default: **NOT enabled**
- Bench logs committed: **NO**
