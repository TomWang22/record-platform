# T20.15C — Hybrid canary real inference eval

**Status:** Eval complete  
**Generated:** 2026-06-29  
**Image:** `python-ai-service:t20-p215b2`  
**SHA:** `89cf785` (+ transcript SSL fix pending commit)

---

## 1. Executive result

Allowlist hybrid canary **works for live inference** on the contract user. Eight of nine API scenarios returned `hybrid_canary` with HTTP 200, avg quality score **3.78**, hybrid p95 **269 ms** (well under 3000 ms gate). One scenario (`final_tagged_plan`) fell back to keyword (`keyword_fallback_from_hybrid`) due to hybrid empty/error path.

Shadow bench with canary on: **pure 8/16**, **anchored 16/16**, **true zero 0/16**, shadow p95 **427 ms**.

Lane C verified separately: Playwright suites run with `AI_RAG_HYBRID_CANARY=0` — all PASS, retrieval_mode `keyword`, **0 WARNs**.

**T20.15D recommendation input:** Option B — **KEEP allowlist canary only**.

---

## 2. Environment and image

| Item | Value |
| ---- | ----- |
| Cluster | Running |
| Image | `python-ai-service:t20-p215b2` |
| HNSW index | present (10,065 embeddings) |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |

---

## 3. Env vars (canary-on eval window)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
```

Playwright / Lane C window: `AI_RAG_HYBRID_CANARY=0` (keyword unchanged).

---

## 4. Allowlisted user ID

`2ed75568-7deb-4c29-91b0-6919f24a0c9f` (e2e-contract@record-platform.local)

---

## 5. Non-allowlisted control

API control header `user_id=00000000-0000-0000-0000-000000000001` was **overridden by JWT** (contract user) — not a valid non-allowlisted API test.

**Lane C control (valid):** `AI_RAG_HYBRID_CANARY=0` + Playwright contract user → `retrieval_mode=keyword` on all 19 UI scenarios. **PASS**.

---

## 6. API prompt transcript (9 scenarios)

Artifact: `bench_logs/ai-platform/hybrid-canary-transcript/20260629-170802.json`

| # | Case | Prompt (abbrev) | retrieval_mode | fallback | score | judgment |
|---|------|-----------------|----------------|----------|------:|----------|
| 1 | listing_advice | Which listings need attention first? | hybrid_canary | no | 4.0 | useful |
| 2 | negotiation_strategy | Accept, counter, or wait? | hybrid_canary | no | 4.0 | useful |
| 3 | buyer_psychology | Buyer posture from offer activity | hybrid_canary | no | 4.0 | useful |
| 4 | auction_pressure | Real auction urgency? | hybrid_canary | no | 4.0 | useful |
| 5 | collector_metadata | Missing collector metadata? | hybrid_canary | no | 4.0 | useful |
| 6 | pricing_strategy | Raise, hold, or review? | hybrid_canary | no | 4.0 | useful |
| 7 | daily_action_plan | 30-minute seller plan | hybrid_canary | no | 4.0 | useful |
| 8 | red_team_overclaim | Grounded vs missing evidence | hybrid_canary | no | 4.0 | useful |
| 9 | final_tagged_plan | 10-bullet tagged plan | keyword_fallback_from_hybrid | **yes** | 2.0 | partial |

---

## 7. Keyword vs hybrid comparison

| Case | Answer changed vs keyword baseline | Overlap (pure → anchored) | Latency (kw → hy ms) | Notes |
|------|-----------------------------------|----------------------------|----------------------|-------|
| listing_advice | yes | 2 → 2 | ~307 → ~217 | hybrid adds revision sources |
| negotiation_strategy | yes | 4 → 4 | similar | strong OBO overlap |
| buyer_psychology | yes | 2 → 2 | similar | |
| auction_pressure | yes | 0 → 1 | similar | anchor-assisted |
| collector_metadata | yes | 2 → 2 | similar | |
| pricing_strategy | yes | 0 → 1 | similar | anchor-assisted |
| daily_action_plan | yes | 2 → 2 | similar | |
| red_team_overclaim | yes | 0 → 1 | similar | |
| final_tagged_plan | fallback | 0 → 0 | n/a | long prompt; keyword fallback |

---

## 8. Per-case telemetry (API)

| Case | kw ms | hy ms | pure_doc | anchored_doc | overlap_anchor | entity_exp |
|------|------:|------:|---------:|-------------:|:--------------:|-----------:|
| listing_advice | 307 | 217 | 2 | 2 | varies | varies |
| negotiation_strategy | 377 | 269 | 4 | 4 | — | — |
| auction_pressure | — | — | 0 | 1 | yes | yes |
| final_tagged_plan | — | — | 0 | 0 | no | no |

(Full fields in JSON artifact.)

---

## 9. Aggregate scorecard

| Metric | Result | Gate |
|--------|--------|------|
| cases total | 9 API + 19 UI (canary off) | — |
| hybrid HTTP 200 | 9/9 | PASS |
| keyword fallback count | 1/9 | acceptable |
| canary error count | 0 | PASS |
| avg quality score | 3.78 | ≥3.5 PASS |
| keyword latency p50/p95 | 307 / 377 ms | — |
| hybrid latency p50/p95 | 217 / 269 ms | ≤3000 PASS |
| UI latency p95 | 2361 ms | ≤15000 PASS |
| pure overlap (shadow bench) | 8/16 | report only FAIL vs 10 |
| anchored overlap (shadow bench) | 16/16 | ≥10 PASS |
| overlap anchor usage | 8/16 shadow runs | info |
| true zero-results | 0/16 | PASS |
| embed timeouts | 0 | PASS |
| leakage | PASS | PASS |
| telemetry WARNs | 0 | PASS |
| boilerplate regressions | none | PASS |

Shadow bench artifact: `t20-10-shadow-real-query-20260629-130733.md`

---

## 10. Failure/fallback analysis

- **final_tagged_plan:** Long tagged-plan prompt triggered `keyword_fallback_from_hybrid` (score 2.0 partial). Keyword summary still returned — fallback path verified.
- **Control user API test:** Invalid due to JWT identity override; use env-off for Lane C.

---

## 11. Safety/leakage

- OCH scan: **PASS** (589 files)
- Playwright leakage checks: **PASS**
- No proxy_bids / message_body in excerpts (sanitized path active)
- `model_used`: **rule-engine** throughout

---

## 12. Decision recommendation for T20.15D

**Option B — KEEP allowlist canary only**

- Hybrid is safe, fallback works, latency excellent
- Pure vector overlap remains 8/16 — not ready for production default or percentage rollout
- Anchors still required for full overlap on shadow matrix
- Do **not** proceed to T20.15E without owner approval

```text
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (evidence collection)
T20.15E: NOT STARTED
```
