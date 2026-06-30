# T20.16B — final_tagged_plan fallback remediation

**Status:** Complete — **PASS**  
**Generated:** 2026-06-30  
**Baseline SHA:** `fd39db3` (T20.16A)  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.16A production-readiness design

---

## 1. Executive verdict

```text
T20.16B final_tagged_plan fallback remediation: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.16C: NOT STARTED
```

---

## 2. Baseline fallback evidence (pre-fix, `t20-p215f`)

| Metric | Value |
|--------|-------|
| Transcript run | `20260630-153546` |
| `final_tagged_plan` retrieval_mode | `keyword_fallback_from_hybrid` |
| hybrid_fallback_reason | `true_zero_result` |
| source_refs_count | **0** |
| keyword / hybrid latency | 1371.85 / 373.91 ms |
| pure / anchored overlap | 0 / 0 |
| quality_score | **2.0** |
| Ladder pattern | 3/27 fallback (11.11%) — **only** `final_tagged_plan` |

---

## 3. Root cause classification

```text
final_tagged_plan root cause:
- prompt_too_long_or_plan_format (primary)
```

**Mechanism:** The `final_tagged_plan` prompt is meta-instructional (`10-bullet`, `[grounded]`, `missing evidence`, `manual review`). Keyword retrieval tokenizes these terms; corpus excerpts rarely contain them, so **keyword score = 0** for all rows → `_chunk_passes_privacy` filters everything → **0 keyword chunks**. Hybrid vector path then has no anchor top-up material → `true_zero_result_after_fallback` → keyword fallback still returns empty → score 2.0.

Not privacy filter, not synthesis rejection, not timeout.

---

## 4. Code changes

| File | Change |
|------|--------|
| `hybrid_canary.py` | `resolve_hybrid_retrieval_plan()` — seller-domain retrieval expansion for `tagged_executive_summary` intent (canary only); `refine_hybrid_fallback_reason()` for explicit `final_tagged_plan_insufficient_hybrid_evidence` |
| `insights.py` | Evaluate gate first; use expanded retrieval query for keyword + hybrid when allowlisted; pass `retrieval_plan` into diagnostics |
| `test_t20_16b_final_tagged_plan_fallback.py` | Unit tests for expansion, fallback reason, anchor cap, privacy |

**Synthesis question unchanged** — original user prompt still drives `tagged_executive_summary` template.

Image rebuilt: **`python-ai-service:t20-p216b`**

---

## 5. Test results

```text
39/39 PASS (15B + 15F + 16B)
```

---

## 6. Live inference transcript (post-fix, 3×9)

| Run | HTTP 200 | Fallback | avg score | worst | hybrid p95 |
|-----|----------|----------|-----------|-------|------------|
| 153935 | 9/9 | 0/9 (0%) | 4.0 | 4.0 | 1230 ms |
| 153947 | 9/9 | 0/9 (0%) | 4.0 | 4.0 | 179 ms |
| 153953 | 9/9 | 0/9 (0%) | 4.0 | 4.0 | 246 ms |
| **Aggregate** | **27/27** | **0/27 (0%)** | **4.0** | **4.0** | **≤1230 ms** |

### `final_tagged_plan` after fix

| Field | Value |
|-------|-------|
| retrieval_mode | **`hybrid_canary`** |
| hybrid_fallback | **false** |
| source_refs_count | **9** |
| anchored_doc_overlap | **1** |
| overlap_anchor_added | **true** |
| quality_score | **4.0** |
| leakage | **PASS** |

---

## 7. Before / after fallback table

| Case | Before (`t20-p215f`) | After (`t20-p216b`) |
|------|----------------------|---------------------|
| listing_advice | hybrid_canary | hybrid_canary |
| negotiation_strategy | hybrid_canary | hybrid_canary |
| buyer_psychology | hybrid_canary | hybrid_canary |
| auction_pressure | hybrid_canary | hybrid_canary |
| collector_metadata | hybrid_canary | hybrid_canary |
| pricing_strategy | hybrid_canary | hybrid_canary |
| daily_action_plan | hybrid_canary | hybrid_canary |
| red_team_overclaim | hybrid_canary | hybrid_canary |
| **final_tagged_plan** | **keyword_fallback_from_hybrid** | **hybrid_canary** |
| **Transcript fallback rate** | **11.11% (3/27 ladder)** | **0% (0/27)** |

---

## 8. Latency (post-fix aggregate)

| Metric | Value |
|--------|-------|
| hybrid p50 (approx) | ~200–400 ms |
| hybrid p95 | **≤1230 ms** (well under 3000 ms gate) |
| canary errors | **0** |

---

## 9. Leakage / telemetry / contracts / Playwright

| Check | Result |
|-------|--------|
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| RAG contract | **PASS** |
| Endpoints contract | **PASS** |
| OCH | **PASS** |
| seller-intelligence Playwright | **PASS** |
| record RAG (Lane C) | **PASS** |
| longform RAG (Lane C) | **PASS** |

---

## 10. Rollback proof

| Step | Result |
|------|--------|
| Image rollback to `t20-p215f` | `final_tagged_plan` → `keyword_fallback_from_hybrid` **confirmed** |
| Restore `t20-p216b` | Fix re-applied |
| Env KEEP restored | PERCENT=0, allowlist unchanged |

---

## 11. Final env (unchanged flags)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Image deployed: **`python-ai-service:t20-p216b`**

---

## 12. Next approval phrase

```text
Approved: start T20.16C pure vector overlap research design
```

Do **not** start T20.16C without this phrase.
