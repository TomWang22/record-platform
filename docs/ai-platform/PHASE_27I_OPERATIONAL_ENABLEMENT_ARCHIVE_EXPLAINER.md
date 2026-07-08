# Phase 27I — operational enablement archive explainer

**Phase 27I:** PASS  
**Phase 27:** CLOSED PASS  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**DB writes:** NO (docs/guard only; no row population in 27I)  
**Migrations applied:** NO  
**Production DB migration:** NOT RUN  
**Production enablement:** NOT APPROVED  
**Generated KPI reports committed:** NO  
**Bench logs committed:** NO  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  

---

## Purpose

Docs-only archive/explainer after Phase 27 CLOSED PASS (`15d8d08`), so future agents can understand controlled local/dev enablement without mistaking it for production rollout.

## Deliverables

| Doc | Role |
| --- | ---- |
| `PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md` | Canonical Phase 27 story + ledger |
| `PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md` | Verify + interpret local/dev row counts |
| `PHASE_27_OBSERVABILITY_CODE_MAP.md` | Docs → code map |
| `scripts/lib/phase27-archive-guard.mjs` | Read-only archive guard |
| `make ai-platform-verify-phase27-archive` | Verifier |

## KPI truth reminder

```text
Local/dev synthetic rows prove write paths work.
Operational KPI row population remains disabled by default.
No production rollout is approved.
```

## Verification

```bash
make ai-platform-verify-phase27-archive
```

## Next allowed step

```text
Approved: start Phase 28A observability production-readiness design only after Phase 27 archive PASS — no live eval, no production default, no PERCENT rollout, no production DB migration.
```
