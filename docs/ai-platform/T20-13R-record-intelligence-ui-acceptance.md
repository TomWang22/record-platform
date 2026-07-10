# T20.13R — Playwright record-intelligence UI acceptance

**Status:** Implemented  
**Generated:** 2026-06-18  
**Baseline SHA:** `b3664fd`

---

## Purpose

Real-world **domain scenario testing** for vinyl marketplace AI — not generic RAG smoke. Validates whether the `/insights` RAG experience helps a record seller make better decisions across:

- Listing advice (weak listings, price/title/revision/buyer interest)
- Negotiation price advice (OBO offers, pending/countered, no message bodies)
- Buyer psychology / negotiation posture (conservative, evidence-based)
- Auction psychology / bidding pressure (sparse-evidence caveats)
- Pricing strategy (raise/hold/review when grounded)
- Collector-facing listing quality (pressing, condition, scarcity gaps)
- Daily seller action plan (ranked offers/listings/auctions/metadata)

Each scenario captures: prompt → rendered UI answer → evidence → timing → domain evaluator judgment → product gap signal.

---

## Test route

**`/insights`** — existing AI RAG card (`data-testid=ai-insight-rag`).

| Element | Test ID |
|---------|---------|
| Question input | `ai-rag-question-input` |
| Answer summary | `ai-rag-summary` |
| Source refs | `ai-source-ref-item` |

Auth: fresh edge login per run (`signInFreshContract`) — same pattern as T20.13P.

---

## Run command

```bash
./scripts/webapp-playwright-strict-edge.sh \
  e2e/ai-rag-record-intelligence.spec.ts \
  --grep "AI record intelligence UI acceptance"
```

---

## Files

| File | Role |
|------|------|
| `webapp/e2e/ai-rag-record-intelligence.spec.ts` | Playwright UI walkthrough (7 domain scenarios) |
| `webapp/e2e/helpers/ai-rag-record-intelligence.ts` | Scenario prompts, domain evaluator, artifact writer |
| `docs/ai-platform/T20-13S-record-intelligence-results.md` | Results report (T20.13S, post-run) |

---

## Scenario prompts

1. **Listing advice** — weakest listings, price/title/revision/buyer interest; do not invent data
2. **Negotiation price advice** — OBO offer amounts/status; seller actions; no private messages
3. **Buyer psychology** — conservative posture inference from offer summaries only
4. **Auction psychology** — bid activity/urgency/risk; sparse-evidence caveat required
5. **Pricing strategy** — raise/hold/review from listing prices, offers, revisions, valuations
6. **Collector listing quality** — pressing/condition/scarcity present vs missing
7. **Daily seller action plan** — prioritized offers/listings/auctions/metadata

---

## Per-scenario capture

```text
scenario_id
prompt
UI answer text
answer char count
HTTP status
retrieval_mode
model_used
synthesis template
source types
refs count
visible source refs
API source excerpts
UI total ms
API ms
leakage result
old boilerplate present yes/no
domain evaluator (score + classifications)
```

---

## Domain evaluator rubric

Score each scenario **0–5**:

| Score | Meaning |
|------:|---------|
| 5 | Strong expert-like marketplace guidance, grounded, specific, conservative, actionable |
| 4 | Useful seller/collector advice with minor gaps |
| 3 | Safe and grounded but shallow or partially useful |
| 2 | Mostly retrieval summary; weak advice |
| 1 | Bad or misleading |
| 0 | Error/leakage/no answer |

Classifications:

```text
answer_usefulness: high / medium / low
grounding: strong / partial / weak / none
domain_depth: strong / medium / shallow
actionability: strong / medium / weak
overclaiming: none / minor / major
safety: pass / fail
```

Specific checks:

- Private message exposure → **fail**
- Hallucinated auction pressure without auction evidence → **fail/penalize**
- Buyer psychology stated as fact → **penalize**
- Cites offer/listing evidence → **reward**
- Says “not enough evidence” when appropriate → **reward**
- Concrete next steps → **reward**
- Collector metadata gaps identified → **reward**

---

## Hard assertions

- 7/7 UI answers render
- Answer length > 120 chars
- Old boilerplate absent
- `retrieval_mode=keyword`
- `model_used=rule-engine`
- `refs > 0`
- Leakage PASS
- Domain safety pass

## Soft quality targets

- Average domain score ≥ 3.5/5
- No major overclaiming
- ≥ 4/7 scenarios include concrete recommended next action

---

## Local artifacts (not committed)

```text
bench_logs/ai-platform/ui-record-intelligence/<timestamp>.json
bench_logs/ai-platform/ui-record-intelligence/<timestamp>.md
bench_logs/ai-platform/ui-record-intelligence/raw-<timestamp>/
webapp/test-results/
```

---

## Scope guardrails

- **No vector rollout**
- **No Phase 21**
- **No DB writes**
- **No embedding tranches**
- **No default-on vector or overlap flags**
- **No product behavior changes** (test helpers/selectors only)

---

## Related tickets

| Ticket | Role |
|--------|------|
| T20.13P/Q | Generic UI RAG acceptance (browser flow baseline) |
| T20.13O-E2E | API-level RAG inference acceptance |
| **T20.13R** | Domain record-intelligence UI acceptance (this harness) |
| **T20.13S** | Results report from local Playwright artifacts |
