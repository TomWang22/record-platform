# T20.15D-S — Hybrid allowlist canary soak

**Status:** Soak complete  
**Generated:** 2026-06-29  
**SHA:** `5e34072`  
**Image:** `python-ai-service:t20-p215b2`

---

## Executive result

Three consecutive API transcript runs (27 cases total) show **stable hybrid canary behavior**: 27/27 HTTP 200, 0 leakage failures, 0 canary errors. Fallback remains isolated to `final_tagged_plan` (3/27). Shadow bench: pure **8/16**, anchored **16/16**, true zero **0/16**, shadow p95 **317 ms**.

**Decision: KEEP allowlist canary** — no rollback trigger met.

**Note:** Playwright RAG suites failed retrieval_mode assertions with canary ON (contract user → `hybrid_canary`). Seller intelligence UI PASS. Lane C keyword behavior verified separately in T20.15D-T.

---

## Environment

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
```

---

## Scorecard (3 API runs × 9 prompts)

| Metric | Result | Gate / note |
|--------|--------|-------------|
| API runs | 3 | — |
| Total cases | 27 | — |
| HTTP 200 count | **27/27** | PASS |
| hybrid_canary count | **24/27** | expected |
| keyword_fallback_from_hybrid | **3/27** | `final_tagged_plan` only |
| avg score | **3.78** | ≥3.5 PASS |
| worst score | **2.0** | `final_tagged_plan` fallback |
| fallback scenarios | `final_tagged_plan` | stable |
| keyword latency p50/p95 | **225 / 317 ms** | — |
| hybrid latency p50/p95 | **108 / 214 ms** | ≤3000 PASS |
| pure overlap (shadow) | **8/16** | report only |
| anchored overlap (shadow) | **16/16** | ≥10 PASS |
| true zero-results | **0/16** | PASS |
| embed timeouts | **0** | PASS |
| canary errors | **0** | PASS |
| leakage failures | **0** | PASS |
| product telemetry WARNs | **0** | PASS |
| Playwright seller UI | **PASS** | — |
| Playwright RAG (canary ON) | **FAIL** retrieval_mode | expected; see D-T |

---

## Artifacts (local only — not committed)

| Run | Directory |
|-----|-----------|
| 1 | `bench_logs/ai-platform/hybrid-canary-transcript/20260629-193129/` |
| 2 | `bench_logs/ai-platform/hybrid-canary-transcript/20260629-193134/` |
| 3 | `bench_logs/ai-platform/hybrid-canary-transcript/20260629-193138/` |
| Shadow | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-153107.md` |

---

## Per-run summary

| Run | hybrid | fallback | avg score |
|-----|--------|----------|-----------|
| 1 | 8/9 | 1/9 | 3.78 |
| 2 | 8/9 | 1/9 | 3.78 |
| 3 | 8/9 | 1/9 | 3.78 |

---

## Decision

```text
Hybrid allowlist canary: KEEP
Rollback triggers not met (no leakage spike, no error spike, stable fallback pattern)
T20.15E: NOT STARTED
```

---

## References

- `scripts/rp-ai-hybrid-canary-transcript.sh`
- `docs/ai-platform/T20-15C-hybrid-canary-real-inference-eval.md`
