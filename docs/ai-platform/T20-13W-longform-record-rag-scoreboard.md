# T20.13W — Long-form record RAG scoreboard

**Generated:** 2026-06-27  
**Baseline SHA:** `8f30fb5` (harness); successful run after response-matching fix  
**Primary artifact:** `bench_logs/ai-platform/longform-rag-session/20260627-041713/`  
**First run (UI timeout on long prompts):** `20260627-040930/` — turns 10–12 hit 120s Playwright wait (exact POST body match); API completed same prompts in ~500ms.

---

## Executive result

```text
Long-form record RAG session: PARTIAL
Average turn score: 3.13/5
Final turn score: 3.0/5
Context retention: partial
Prompt length stress: PASS (API); UI required relaxed response matcher
Production retrieval: keyword
model_used: rule-engine
Vector rollout: NOT APPROVED
Phase 21: not started
```

---

## Session metadata

| Field | Value |
|-------|-------|
| Mode | UI (Playwright) + API cross-check |
| Route | `/insights` → RAG card |
| Browser | chromium 1280×720 |
| Timestamp | `20260627-041713` |
| Command | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"` |
| Login | e2e-contract@record-platform.local |
| Max prompt chars | 4,589 (turn 12) |
| Max estimated tokens | 1,148 (chars÷4) |
| p50 / p95 UI ms | 3,050 / 6,283 |
| p50 / p95 API ms | 3,174 / 6,190 |
| Turns hard-pass | 12/12 |
| Leakage | PASS |

**Runtime config:** `AI_MODEL_PROVIDER=rule`, `AI_RAG_MAX_CONTEXT_TOKENS=2048`, `AI_RAG_MAX_CHUNKS=8`, generative Ollama **not** used for RAG synthesis.

---

## Turn-by-turn scoreboard

| Turn | Theme | Prompt chars | Est tokens | Answer chars | UI ms | API ms | Score | Grounding | Actionability | Context retention | Result |
| ---- | ----- | -----------: | ---------: | -----------: | ----: | -----: | ----: | --------- | ------------- | ----------------- | ------ |
| 1 | Catalog health | 150 | 38 | 572 | 2,233 | 2,064 | 4.0 | partial | medium | n/a | PASS |
| 2 | Prioritized action (30 min) | 151 | 38 | 297 | 1,607 | 1,533 | 4.0 | partial | medium | n/a | PASS |
| 3 | Negotiation strategy | 168 | 42 | 515 | 3,789 | 2,870 | 3.5 | partial | medium | n/a | PASS |
| 4 | Buyer psychology | 181 | 46 | 522 | 1,829 | 1,758 | 3.0 | partial | medium | n/a | PASS |
| 5 | Auction pressure | 156 | 39 | 396 | 6,283 | 6,190 | 3.5 | partial | medium | n/a | PASS |
| 6 | Collector metadata | 154 | 39 | 253 | 5,871 | 5,751 | 2.0 | partial | medium | n/a | PARTIAL |
| 7 | Listing rewrite | 157 | 40 | 253 | 4,556 | 4,360 | 3.5 | partial | medium | n/a | PASS |
| 8 | Pricing plan | 132 | 33 | 496 | 4,225 | 4,100 | 3.5 | partial | medium | n/a | PASS |
| 9 | User tradeoff re-rank | 188 | 47 | 215 | 5,033 | 4,897 | 2.0 | partial | medium | poor | PARTIAL |
| 10 | Long prompt — final plan | 3,865 | 967 | 434 | 3,050 | 2,943 | 3.0 | partial | medium | partial | PARTIAL |
| 11 | Red-team overclaim | 4,177 | 1,045 | 434 | 1,839 | 3,374 | 2.5 | partial | medium | partial | PARTIAL |
| 12 | Executive summary | 4,589 | 1,148 | 434 | 1,378 | 3,174 | 3.0 | partial | medium | partial | PARTIAL |

**Best turns:** 1–2 (4.0) — revision/catalog grounding with next steps.  
**Worst turns:** 6, 9 (2.0) — generic template; ignored collector metadata and jazz/stale-inventory tradeoff.

---

## Full transcript (selected turns)

### Turn 1 — Catalog health

**Prompt:** (150 chars) — catalog health check, do not invent data.

**Rendered answer:**

```text
Recent listing revision signals: 1. Revision: Listed from record 1781388860548 … 2. Related listings: 2 listing excerpt(s) 3. Offer impact: no offer summaries linked in this set Recommended next step: Confirm offer amounts still match revised listing price/terms. Grounding: based on 8 excerpt(s) from listing, listing_revision, record. Private message bodies were not used.
```

**Evidence:** listing_revision, listing, record (7 refs).  
**Telemetry:** HTTP 200 · keyword · rule-engine · template=listing_revision_changes · UI 2,233 ms · leakage PASS  
**Score:** 4.0 — strong catalog/revision grounding; buyer-interest gap noted.

---

### Turn 3 — Negotiation strategy

**Answer excerpt:** 4 pending, 4 countered; amounts $4136/$4436/$4419; recommend review inbox.  
**Score:** 3.5 — useful offer summary; no accept/counter/hold taxonomy.

---

### Turn 9 — User tradeoff re-rank

**Prompt:** stale inventory > max price; avoid underselling rare jazz.

**Answer:** Generic “listing=8 … review attached source excerpts” — **did not** re-rank or mention jazz/stale inventory.

**Score:** 2.0 · context_retention: **poor**

---

### Turn 10 — Long prompt stress (3,865 chars)

**Finding:** API ~500 ms; UI ~3 s after matcher fix. Answer **ignored** accumulated context — same `private_negotiation_no_messages` template with 0 offers despite turn 3 showing 4 pending/4 countered.

**Score:** 3.0 · context_retention: partial (prompt accepted, synthesis did not integrate)

---

### Turn 12 — Final executive summary

**Prompt:** 4,589 chars; request 10 bullets tagged `[grounded]` / `[missing evidence]` / `[needs manual review]`.

**Answer:** Identical 434-char negotiation boilerplate — **no bullets, no tags**.

**Score:** 3.0 · hard tag requirement: **FAIL**

---

## Long-context behavior

| Question | Answer |
|----------|--------|
| Latency grow with prompt length? | **No** — turns 10–12 (~4k chars) faster than turn 5 (6.3s). Long prompt does not add retrieval cost. |
| Quality degrade with length? | **Yes** — turns 10–12 collapse to same template; accumulated context ignored. |
| Retain preferences turns 9–12? | **No** — jazz/stale-inventory/30-min constraints not reflected in answers. |
| Self-correct overclaiming (turn 11)? | **No** — no meta-review; repeated negotiation template. |
| Useful final seller plan? | **No** — no ranked plan or tagged bullets. |
| Source refs attached? | **Yes** — 8 refs every turn; keyword/rule-engine throughout. |
| Retrieval stay keyword? | **Yes** — 12/12 keyword, rule-engine. |

---

## Prompt/window findings

| Finding | Detail |
|---------|--------|
| Max prompt chars tested | 4,589 |
| Max estimated tokens | ~1,148 (chars÷4) |
| Runtime RAG context cap | **2,048 tokens** (`AI_RAG_MAX_CONTEXT_TOKENS`) |
| Timeouts | First UI run: turns 10–12 @ 120s (Playwright matcher); fixed with prefix match |
| Truncation observed | Accumulated context truncated to ~400 chars/turn in prefix; full prompt still ~4.5k |
| Safe prompt recommendation | **≤2k chars** for reliable domain-specific synthesis; **≤4.5k** returns answers but not context-aware |
| 100k-token context | **NOT PROVEN** — not exposed in runtime; rule-engine RAG does not consume generative context window |

```text
100k-token context was not proven unless model/runtime exposes and passes that tier.
```

---

## Product findings

| Question | Verdict |
|----------|---------|
| Good enough for serious record seller? | **Partial** — strong as evidence assistant for offers/revisions; weak as strategic advisor across long sessions. |
| Strong scenarios | Catalog health (T1), negotiation summaries when offers retrieved (T3–4), pricing with offer amounts (T8). |
| Weak scenarios | Collector metadata (T6), tradeoff re-rank (T9), long-context final plan (T10–12), tagged executive summary (T12). |
| Evidence assistant vs strategic advisor? | **Evidence assistant** — each turn re-retrieves and applies template; no session memory or synthesis over accumulated instructions. |
| Structured endpoints before Phase 21? | **Yes** — required for listing_advice, negotiation_strategy, auction_pressure, collector metadata. |

---

## Recommended next engineering tickets

1. **T20.13Y** — structured `listing_advice` endpoint (weak listings, buyer interest, ranked actions)
2. **T20.13Z** — structured `negotiation_strategy` endpoint (accept/counter/review with offer amounts)
3. **T20.13X** — longform synthesis improvements (session context in prompt body → template selection; tagged bullet output)
4. Collector metadata extraction (pressing/condition/scarcity from listing excerpts)
5. **T20.14 remains blocked** — vector rollout not approved
6. Keep vector rollout blocked; do not start Phase 21

---

## Final verdict

```text
Production long-form keyword RAG: PARTIAL
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Summary:** Twelve-turn gauntlet completes without crashes or leakage. Keyword rule-engine path is stable through ~4.5k-char prompts, but **synthesis ignores accumulated session context** — long prompts do not produce better plans, only different retrieval keywords leading to the same templates. System behaves as a **per-turn evidence assistant**, not a multi-turn seller strategist.

---

## Related

| Ticket | Role |
|--------|------|
| T20.13V | Gauntlet harness |
| **T20.13W** | This scoreboard |
| T20.13R/S | Single-turn domain intelligence |
| T20.13T/U | Auction fix + protocol pipeline |
