# T20.15F — Hybrid percentage gate implementation (percent-zero deploy)

**Status:** Complete  
**Generated:** 2026-06-29  
**Parent:** T20.15E design  
**Image:** `python-ai-service:t20-p215f`  
**Baseline SHA:** `9f9fd59` (T20.15E)

---

## Purpose

Implement deterministic percentage cohort gate support in python-ai-service, deploy with **`AI_RAG_HYBRID_CANARY_PERCENT=0`**, prove D-T controls and rollback still work. **No percentage traffic enabled.**

```text
Hybrid canary evidence collection — NOT vector production rollout.
```

---

## Implementation summary

| Component | Change |
|-----------|--------|
| `percentage_bucket(user_id)` | SHA-256 deterministic bucket 0–99 |
| `in_percentage_cohort(user_id, percent)` | `percent<=0` → false; `bucket < percent` → true; percent>100 clamped |
| `evaluate_hybrid_canary_gate()` | Gate order: disabled → allowlist → percent=0 → unauth/no scope → prod block → percentage → keyword_default |
| `gate_reason` telemetry | `allowlist` \| `percentage` \| `keyword_default` \| `prod_percent_blocked` |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` | Default `0`; blocks percent cohort in `record-platform` namespace |
| Diagnostics | `enabled`, `eligible`, `gate_reason`, `percentage`, `percentage_bucket`, `percentage_cohort`, `allowlisted`, etc. |

Allowlist continues to override percentage. Percent=0 excludes all percentage users.

---

## Changed files

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/config.py` | `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` |
| `services/python-ai-service/app/ai/hybrid_canary.py` | Percentage gate + diagnostics |
| `services/python-ai-service/app/ai/insights.py` | Emit `hybrid_canary` diagnostics when canary enabled |
| `services/python-ai-service/tests/test_t20_15b_hybrid_canary.py` | Allowlist wins over percent>0 |
| `services/python-ai-service/tests/test_t20_15f_hybrid_canary_percentage.py` | New T20.15F gate tests (17 cases) |

---

## Test results

| Suite | Result |
|-------|--------|
| Hybrid canary tests (15B + 15F) | **27/27 PASS** |
| Full python-ai unittest (docker) | **282 PASS**, 4 pre-existing errors in `test_rag_retrieval` privacy integration (unchanged) |

---

## Contract / readiness validation

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** |

---

## Control / rollback drill (D-T style)

| Step | Env | `retrieval_mode` | `gate_reason` | Result |
|------|-----|------------------|---------------|--------|
| A. Fake allowlist | allowlist=`00000000-…`, PERCENT=0 | **keyword** | **keyword_default** | **PASS** |
| B. Restore allowlist | allowlist=contract user | **hybrid_canary** | **allowlist** | **PASS** |
| C. Rollback | `CANARY=0` | **keyword** | (n/a — canary off) | **PASS** |
| D. Final KEEP | `CANARY=1`, real allowlist, PERCENT=0 | **hybrid_canary** | **allowlist** | **PASS** |

---

## Real inference mini-check (9 API scenarios, post-KEEP)

| Metric | Result |
|--------|--------|
| HTTP 200 | **9/9** |
| hybrid_canary | **8/9** |
| keyword_fallback_from_hybrid | **1/9** (`final_tagged_plan`) |
| avg / worst score | **3.78 / 2.0** |
| hybrid p50 / p95 | **228 / 467 ms** |
| keyword p50 / p95 | **440 / 928 ms** |
| leakage | **PASS** |
| canary errors | **0** |

`gate_reason=allowlist` confirmed on allowlisted contract user responses.

---

## Final cluster env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Image: `python-ai-service:t20-p215f`

---

## Stop condition

```text
T20.15F percentage gate: IMPLEMENTED (percent remains 0)
T20.15G 1% eval: NOT STARTED — NOT APPROVED
Vector production default: NOT APPROVED
Production default: keyword
Hybrid allowlist canary: KEEP
```

---

## Required next approval phrase

```text
Approved: start T20.15G 1% hybrid canary eval window dev-staging only
```

---

## References

- `docs/ai-platform/T20-15E-limited-percentage-hybrid-canary-design.md`
- `docs/ai-platform/T20-15D-T-hybrid-canary-control-and-rollback-drill.md`
