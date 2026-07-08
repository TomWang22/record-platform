# Phase 26E — usefulness observation export closeout

**Phase 26E:** PASS  
**Phase 26F:** NOT STARTED  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Usefulness writes default enabled:** NO  
**Runtime writes enabled by default:** NO  
**Raw/private fields stored:** NO  
**H1/H2/H3 usefulness labels tested:** YES  
**No model accuracy claim without ground truth:** YES  
**Usefulness over time time-series:** PASS when rows exist; GAP when absent; PARTIAL when protocol/label coverage incomplete  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Executive verdict

Phase 26E implements the **usefulness observation export write path** for `ai.ai_kpi_usefulness_observations` behind default-off flags. Payloads are built from caller-supplied rubric metadata only — no raw questions, answers, or response bodies. H1/H2/H3 evidence labels are preserved offline in unit tests; no live inference or matrix replay was run.

Usefulness/rubric pass rates are reported — not model accuracy without ground truth.

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `services/python-ai-service/app/ai/kpi_usefulness_observations.py` | Payload builder, evidence label validation, safe emit |
| `services/python-ai-service/app/ai/kpi_observability.py` | Usefulness channel wired |
| `scripts/lib/phase26e-usefulness-observation-kpi-readonly.mjs` | Usefulness time-series aggregator |
| `scripts/lib/phase26e-usefulness-observation-guard.mjs` | Read-only closeout guard |
| `tests/test_phase26e_kpi_usefulness.py` | Python unit tests (mocked) |
| `make ai-platform-verify-phase26e-usefulness` | Verifier entrypoint |

---

## Usefulness write behavior

```text
default flags OFF / master disabled:
  emit_usefulness_observation_safe(...) → None, no DB call

flags enabled (tests/dev only):
  validates payload; stores allowed rubric fields only
  writes one row to ai.ai_kpi_usefulness_observations
  returns inserted id when insert_fn/async DB available

write failure:
  direct writer may raise
  safe emitter catches/logs and returns None
```

---

## Evidence labels preserved

```text
H1 baseline 57105/57105
H2 replay 57105/57105
H3 replay 57105/57105
Phase 22C 7200/7200 sample only
Phase 22B 15/15 smoke only
manual/dev usefulness observation
171315/171315 is labeled H1+H2+H3 only
```

---

## KPI gap status

| Gap | Phase 26E status | Next phase |
| --- | ---------------- | ---------- |
| usefulness over time time-series | Write path + extractor PASS/PARTIAL/GAP when rows exist/absent | Operational population in controlled environments |
| query latency from observations | 26D write path (default-off) | — |
| H1 full-matrix latency in committed docs | GAP | Doc policy only |
| data_to_searchable_ms | 26C write path (default-off) | — |
| ingestion_success_rate per source type | 26B write path (default-off) | — |

---

## Verification

```bash
make ai-platform-verify-phase26e-usefulness
```

---

## Next allowed step

```text
Approved: start Phase 26F KPI dashboard/report generation only after Phase 26E usefulness export PASS — no live eval, no production default, no PERCENT rollout.
```
