# T20.16D — Hybrid production-readiness eval plan

**Status:** Plan complete — ready for D-LIVE  
**Generated:** 2026-06-30  
**Baseline SHA:** `d28ed65` (T20.16C)  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.16C pure vector research (report-only 8/16)

---

## 1. Objective

Collect **production-readiness evidence** for **Lane B — hybrid anchored allowlist canary** using **real JWT-authenticated live API inference**, supplemented by shadow timing. This eval does **not** approve vector or hybrid as production default.

---

## 2. Non-goals

- Enable vector retrieval as production default
- Set `AI_RAG_HYBRID_CANARY_PERCENT` above 0
- Rename hybrid canary as production rollout
- Remove keyword fallback or overlap anchors
- Weaken privacy/leakage filters
- Expose message bodies
- Use generative Ollama as production RAG default
- Start percentage rollout work

---

## 3. Current lanes

| Lane | Role | Eval in D-LIVE |
|------|------|----------------|
| **C — keyword** | Production default | Rollback drill + Lane C controls |
| **B — hybrid anchored** | Allowlist canary | Primary: 5× API transcript + seller Playwright |
| **A — pure vector** | Report-only (8/16) | Shadow supplementary — separate from anchored gate |

---

## 4. Eval matrix

| Path | User / env | Expected `retrieval_mode` | `gate_reason` |
|------|------------|---------------------------|---------------|
| Allowlist contract | JWT `e2e-contract@…` | `hybrid_canary` | `allowlist` |
| Fake allowlist | `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=00000000-0000-0000-0000-000000000000` | `keyword` | `keyword_default` |
| CANARY=0 rollback | `AI_RAG_HYBRID_CANARY=0` | `keyword` | n/a |
| Post-restore KEEP | Standard env below | allowlist → hybrid; others keyword | per T20.15 pattern |

JWT `sub` drives gating — **no header user-ID spoofing**.

---

## 5. Live transcript plan

- **5×** `bash scripts/rp-ai-hybrid-canary-transcript.sh`
- **45 API cases** minimum (9 cases × 5 runs)
- Includes **`final_tagged_plan`** (T20.16B remediation verified on `t20-p216b`)
- Score each answer; record `retrieval_mode`, `hybrid_fallback_reason`, latency, leakage

---

## 6. Shadow supplementary plan

- **3×** `bash scripts/rp-ai-shadow-real-query-timing.sh` with `BENCH_REQUIRE_OLLAMA_WARM=1`
- Report **pure** and **anchored** overlap separately
- **1×** `bash scripts/rp-ai-shadow-source-diagnostic.sh` (informational; failures classified, non-blocking unless leakage)

---

## 7. UI / product plan

| Suite | Env | Purpose |
|-------|-----|---------|
| seller-intelligence | KEEP allowlist | Real hybrid product path |
| record RAG | Lane C fake allowlist | Keyword control assertions |
| longform RAG | Lane C fake allowlist | Keyword control assertions |
| `ai-quality-telemetry-report.mjs` | post-Playwright | WARN count |

---

## 8. Required gates

| Gate | Threshold |
|------|-----------|
| HTTP 200 (transcript) | **45/45** |
| Fallback rate | **≤5%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality score | **≥3.5** |
| Worst quality score | **≥3.0** |
| Hybrid p95 | **≤3000 ms** |
| Canary errors | **0** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| OCH | **PASS** |
| Anchored overlap (shadow) | **16/16** (hard min **≥10/16**) |
| True zero-results | **0** |
| Embed timeouts | **0** |
| Playwright | **PASS** |
| Contracts / readiness | **PASS** |

---

## 9. Rollback plan

1. **Percent-only off:** `AI_RAG_HYBRID_CANARY_PERCENT=0` (already KEEP)
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword for allowlist user
3. **Image rollback:** `t20-p216b` (current) or `t20-p215f` (prior)
4. **KEEP restore:**

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## 10. Stop condition

- **PASS:** Proceed to T20.16E decision + T20.16F closeout in same batch
- **FAIL:** Write failure in D-LIVE doc, restore KEEP env, stop before E/F with failure recommendation (option A or B only)

---

## KEEP env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
image: python-ai-service:t20-p216b
```
