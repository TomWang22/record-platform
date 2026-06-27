# T20.13V — Long-form record collector RAG gauntlet

**Status:** Implemented  
**Generated:** 2026-06-27  
**Baseline SHA:** `8f30fb5`

---

## Purpose

Stress-test keyword RAG through a **12-turn realistic record-seller session** — multi-turn prompting, accumulated context, long prompts, domain depth, latency, and grounding. This is **prompt/evaluation tuning**, not model fine-tuning or vector rollout.

---

## Non-goals

- No vector default / rollout
- No Phase 21 / T20.14 / T20.15
- No DB writes or embedding tranches
- No production retrieval changes
- No model fine-tuning claims

---

## Runtime limits (V1 inspection)

| Setting | Value |
|---------|-------|
| `AI_MODEL_PROVIDER` | `rule` |
| Generative Ollama for RAG | **No** — rule-engine synthesis only |
| `AI_RAG_MAX_CONTEXT_TOKENS` | 2048 |
| `AI_RAG_MAX_CHUNKS` | 8 |
| `AI_MAX_RESPONSE_TOKENS` | 512 |
| `AI_OLLAMA_TIMEOUT_MS` | 2000 (not used for keyword RAG path) |

**100k-token context was not proven** — runtime exposes 2048 RAG context tokens; gauntlet uses character tiers via accumulated context on turns 10–12 (~6k chars stress tier).

Safe prompt tiers tested:

| Tier | Approx chars |
|------|-------------|
| short | ~500 |
| medium | ~2k |
| long | ~6k (turn 10 accumulated) |
| stress | ~12k (not attempted unless turn 10 passes) |

---

## Scenario arc (12 turns)

1. Catalog health  
2. Prioritized action list (30 min)  
3. Negotiation strategy  
4. Buyer psychology  
5. Auction pressure  
6. Collector metadata quality  
7. Listing rewrite request  
8. Pricing plan  
9. User tradeoff re-rank (stale inventory vs rare jazz)  
10. Long prompt stress — final action plan (accumulated context)  
11. Red-team overclaiming check  
12. Final executive summary (tagged bullets)

UI does not preserve conversation — turns 10–12 prepend accumulated prior-answer summaries + user preferences.

---

## Modes

### Mode A — UI (primary)

```bash
./scripts/webapp-playwright-strict-edge.sh \
  e2e/ai-rag-longform-record-session.spec.ts \
  --grep "AI longform record collector RAG session"
```

### Mode B — API (optional)

```bash
python3 scripts/rp-ai-longform-rag-session.py \
  --base-url https://record-platform.test \
  --user e2e-contract@record-platform.local
```

---

## Files

| File | Role |
|------|------|
| `webapp/e2e/ai-rag-longform-record-session.spec.ts` | Playwright 12-turn UI gauntlet |
| `webapp/e2e/helpers/ai-rag-longform-record-session.ts` | Prompts, context builder, evaluator, artifacts |
| `scripts/rp-ai-longform-rag-session.py` | Optional API runner |
| `docs/ai-platform/T20-13W-longform-record-rag-scoreboard.md` | Results (post-run) |

---

## Per-turn telemetry

```text
turn_id, prompt_chars, estimated_prompt_tokens, accumulated_context_chars
ui_total_ms, api_ms, http_status, retrieval_mode, model_used
synthesis_template, answer_chars, source_types, refs_count
visible_source_refs_count, api excerpts, leakage, timeout, error
shadow telemetry (if present in response, defaults unchanged)
```

---

## Scoring rubric (0–5)

| Score | Meaning |
|------:|---------|
| 5 | Expert-like, grounded, specific, actionable, conservative |
| 4 | Useful and grounded with minor gaps |
| 3 | Safe and grounded but shallow |
| 2 | Mostly generic or weakly actionable |
| 1 | Misleading, irrelevant, or too thin |
| 0 | Error, empty, unsafe, or leakage |

Classifications: grounding, actionability, domain_depth, overclaiming, context_retention, safety.

---

## Hard acceptance

- 12/12 turns render answer
- `retrieval_mode=keyword`, `model_used=rule-engine`
- Leakage PASS, no old boilerplate, no HTTP 500
- Final turn includes `[grounded]` / `[missing evidence]` / `[needs manual review]` tags

## Soft targets

- Avg score ≥ 3.5, final turn ≥ 4
- ≥ 8/12 turns with concrete next actions
- Context retention good/partial on turns 9–12
- p95 UI ≤ 8s, p95 API ≤ 7s

---

## Local artifacts (not committed)

```text
bench_logs/ai-platform/longform-rag-session/<timestamp>.json
bench_logs/ai-platform/longform-rag-session/<timestamp>.md
bench_logs/ai-platform/longform-rag-session/raw-<timestamp>/
```

---

## Related

| Ticket | Role |
|--------|------|
| T20.13R/S | Domain record-intelligence UI |
| T20.13T/U | Auction fix + protocol pipeline |
| **T20.13V** | Long-form gauntlet harness |
| **T20.13W** | Scoreboard report |
