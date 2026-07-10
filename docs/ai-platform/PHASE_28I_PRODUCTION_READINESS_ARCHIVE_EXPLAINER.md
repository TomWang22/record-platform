# Phase 28I — production-readiness archive explainer

**Phase 28I:** PASS  
**Phase 28:** CLOSED PASS  
**Live eval run:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production DB migration:** NOT RUN  
**Production enablement:** NOT APPROVED  
**Generated reports committed:** NO  
**Bench logs committed:** NO  
**Production default:** keyword  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  

---

## Purpose

Docs-only archive/explainer after Phase 28 CLOSED PASS (`39d9584`), so future agents do not confuse the **25920 controlled observability matrix** with Phase 22 full parity or production rollout.

## Deliverables

| Doc | Role |
| --- | ---- |
| `PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md` | Canonical Phase 28 story + ledger |
| `PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md` | Verify + interpret matrix vs Phase 22 |
| `PHASE_28_OBSERVABILITY_CODE_MAP.md` | Docs → code map |
| `scripts/lib/phase28-archive-guard.mjs` | Read-only archive guard |
| `make ai-platform-verify-phase28-archive` | Verifier |

## Evidence separation (critical)

```text
Phase 22 full parity: 57105/57105 per protocol → 171315/171315 labeled H1+H2+H3
Phase 28 controlled matrix: 25920/25920 separate evidence label
Never merge 25920 into 57105 or 171315 totals.
Never call Phase 28 "full parity" or "production rollout approved".
```

## What Phase 28 proved

Controlled KPI observability can survive:

- real H1/H2/H3 protocol matrix load (25920 probes),
- `/tmp` combined KPI report generation,
- disable-switch rollback with unchanged row counts.

## What Phase 28 did not do

```text
Did NOT change production default (keyword).
Did NOT raise PERCENT or ALLOW_PROD_PERCENT (both 0).
Did NOT approve hybrid/vector production default.
Did NOT commit /tmp KPI reports or bench logs.
Did NOT enable production KPI writes by default after closeout.
```

## Verification

```bash
make ai-platform-verify-phase28-archive
```

## Next allowed step

```text
Approved: start Phase 29A observability production enablement RFC/design only after Phase 28 archive PASS — no live eval, no production default, no PERCENT rollout, no production DB migration, no production KPI enablement.
```

Do not start Phase 29B or any production enablement without explicit owner approval.
