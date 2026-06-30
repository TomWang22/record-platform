# T20.15V — 50% hybrid gate verification (percent-zero deploy)

**Status:** Complete — verification-only  
**Generated:** 2026-06-29  
**Baseline SHA:** `a3faaa8` (T20.15U)  
**Image:** `python-ai-service:t20-p215f` (unchanged — no runtime code changes)  
**Parent:** T20.15U design

---

## Summary

T20.15F gate engine already supports arbitrary percent via `bucket < percent`. **No `hybrid_canary.py` changes required for 50%.** V added one test asserting buckets 0–49 ∈ cohort and bucket ≥50 ∉ at `PERCENT=50`.

| Item | Result |
|------|--------|
| Code changed | **Tests only** (`test_t20_15f_hybrid_canary_percentage.py`) |
| Image rebuilt | **No** — `t20-p215f` retained |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** (unchanged) |

---

## Gate behavior verified

| Rule | Verified |
|------|----------|
| `percent=50` → buckets 0–49 in cohort | Yes (test) |
| `percent=50` → bucket ≥50 excluded | Yes (test: buckets 50, 55) |
| Allowlist overrides percent | Yes |
| `percent=0` → keyword_default non-allowlisted | Yes |
| Unauthenticated / invalid UUID → keyword_default | Yes |
| Prod percent blocked without `ALLOW_PROD_PERCENT=1` | Yes |
| Diagnostics telemetry | Yes |
| No behavior change at PERCENT=0 | Yes |

---

## Test results

| Suite | Result |
|-------|--------|
| Hybrid canary (15B + 15F) | **31/31 PASS** |

---

## Contract / readiness

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** |

---

## D-T control drill

| Step | `retrieval_mode` | `gate_reason` | Result |
|------|------------------|---------------|--------|
| Fake allowlist | keyword | keyword_default | **PASS** |
| `CANARY=0` | keyword | (n/a) | **PASS** |
| KEEP restore | hybrid_canary | allowlist | **PASS** |

---

## Final env (post-V)

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
T20.15V: COMPLETE (verification-only)
T20.15W: authorized to proceed
PERCENT=0
```
