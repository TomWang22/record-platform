# T20.15AF — Hybrid canary 100% decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-30  
**Baseline SHA:** `2d2e32d` + AE eval  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15AE — 100% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15AE 100% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Production default: keyword
Vector production default: NOT APPROVED
T20.15AG hybrid canary ladder closeout: RECOMMENDED
T20.16A: NOT STARTED — explicit approval required
```

---

## 2. Evidence summary (D-S through AE)

Percentage ladder **1% → 100%** all PASS with percent restored after each eval window. T20.15AD verification-only (tests); T20.15AE proved all buckets 0–99 + bucket 95 at PERCENT=100 with unauthenticated control.

---

## 3. Ladder summary table

| Tranche | Eval doc | HTTP 200 | Fallback | Hybrid p95 | Anchored | Pure | Leakage | WARNs | Restored |
|---------|----------|----------|----------|------------|----------|------|---------|-------|----------|
| 1% | T20.15G | 27/27 | 11.11% | 223 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 5% | T20.15K | 27/27 | 11.11% | ~223 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 10% | T20.15O | 27/27 | 11.11% | 223.8 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 25% | T20.15S | 27/27 | 11.11% | ~350 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 50% | T20.15W | 27/27 | 11.11% | ~515 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 75% | T20.15AA | 27/27 | 11.11% | 472.88 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 100% | T20.15AE | 27/27 | 11.11% | 345.97 ms | 16/16 | 8/16 | PASS | 0 | yes |

---

## 4. T20.15AE gate verdict table

| Gate | Result |
|------|--------|
| HTTP 200 (27 allowlist transcript) | **PASS** |
| Cohort API (66 prompts) | **PASS** |
| Fallback ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 ≤ 3000 ms | **PASS** (345.97 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Percent restored | **PASS** |
| Playwright / source diagnostic / OCH | **PASS** |

---

## 5. Options

### A. ROLLBACK hybrid entirely — **Not selected**

### B. KEEP allowlist only, percent=0 ✅ **SELECTED**

Operational default: single allowlisted contract user on hybrid_canary for continued evidence; all other users keyword.

### C. KEEP allowlist + close hybrid canary ladder ✅ **RECOMMENDED**

Ladder objective met; no further percentage tranches without new approval.

### D. KEEP PERCENT=100 active — **Not selected**

Explicit owner approval required; default remains PERCENT=0.

---

## 6. Rationale

AE passed all hard gates at PERCENT=100 with stable fallback (11.11%, concentrated on `final_tagged_plan`), hybrid latency well under 3000 ms, and clean post-restore keyword_default for all percentage cohort users. Pure vector overlap remains 8/16 — insufficient for vector production default. Hybrid anchors deliver 16/16. Percentage cohort math is proven; no operational benefit to leaving PERCENT>0 active.

---

## 7. Final env state

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

## 8. Rollback runbook

1. Set `AI_RAG_HYBRID_CANARY=0` on `deployment/python-ai-service`.
2. Rollout restart; verify all users → `keyword` / `keyword_default`.
3. Re-run `scripts/rp-ai-hybrid-canary-transcript.sh` — expect keyword for all cases.
4. Re-run contracts + OCH.

To restore allowlist-only hybrid: set `AI_RAG_HYBRID_CANARY=1`, allowlist UUID, `PERCENT=0`.

---

## 9. Vector production default

**NOT APPROVED**

---

## 10. Production default

**keyword** (rule-engine synthesis)

---

## 11. Remaining blockers before any production-default decision

- Pure vector overlap remains **8/16**
- Hybrid anchors required for **16/16** (met in shadow; production default still keyword)
- Fallback still concentrated on `final_tagged_plan` (3/27 = 11.11%)
- Production default remains **keyword**

---

## 12. Next ticket recommendation

**T20.15AG** — hybrid canary ladder closeout (docs only).

After AG: await explicit approval for **T20.16A hybrid production-readiness design only**.

Required approval phrase:

```text
Approved: start T20.16A hybrid production-readiness design only
```
