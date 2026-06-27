# P21.3A — Session memory design

**Status:** Designed + minimal prototype  
**Baseline SHA:** `0116091`  
**Phase:** 21 — non-vector product track

---

## Problem

Longform seller intelligence testing showed the system relied on **client-side prompt accumulation** (`ACCUMULATED SESSION CONTEXT` pasted into each turn) rather than durable server-side session state. Turn 9 tradeoffs (stale inventory vs rare jazz) and turn 12 tagged final plans only worked when the client re-sent prior context.

---

## Goal

Provide **short-lived, safe, derived session memory** so multi-turn seller workflows retain preferences and prior answer summaries without re-prompting or exposing private message bodies.

---

## Memory scope

### Stored (safe, derived)

| Field | Example |
| ----- | ------- |
| `preferences` | "prioritize moving stale inventory over maximizing top dollar" |
| `constraints` | "avoid underselling rare jazz records" |
| `prior_summaries` | Truncated rule-engine answer text per turn |
| `source_ref_ids` | `listing:66a83502…`, `obo_offer_summary:9444bacb…` |
| `missing_evidence` | Caveats from synthesis (e.g. no auction refs) |
| `safety_notes` | Static reminders that message bodies are never stored |

### Never stored

- Raw message bodies
- Private OBO message text
- Raw proxy bid data (`max_bid_cents`, `proxy_bids`)
- Unfiltered metadata JSON dumps
- Cross-user data

---

## Memory model

**Prototype store:** in-memory per process, TTL 3600s, thread-safe.

No DB migration for P21.3. Production durability (Redis/Postgres) is out of scope for this ticket.

```python
SessionState:
  session_id: str
  user_id: str
  created_at, updated_at: ISO8601
  turn_count: int
  preferences: list[str]
  constraints: list[str]
  prior_summaries: list[str]   # max 8, 500 chars each
  source_ref_ids: list[str]    # max 20
  missing_evidence: list[str]
  safety_notes: list[str]
```

**Limits:** 4000 chars total serialized memory; sanitizer rejects forbidden patterns.

---

## API shape (additive)

Gateway maps `/api/ai/*` → python-ai `/ai/*` (existing proxy).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/ai/session/start` | Create session for authenticated user |
| POST | `/api/ai/session/query` | RAG turn with memory read/write |
| GET | `/api/ai/session/{session_id}` | Inspect session state |
| POST | `/api/ai/session/reset` | Delete session |

### `session/query` flow

1. Load session (user-scoped; 404 if missing or wrong user)
2. Build synthesis context from memory (`ACCUMULATED SESSION CONTEXT`)
3. **Keyword retrieval** on current user prompt only (no vector)
4. **Synthesis** on augmented prompt (memory + current message)
5. Update session from turn (preferences, summary, refs)
6. Return standard envelope + `details.session_memory`

---

## Query behavior

Retrieval mode unchanged: **keyword only**, `model_used=rule-engine`.

Memory augments **synthesis/classification only**, not embedding or vector shadow paths.

Prior longform failures addressed:

| Turn | Prompt theme | Memory benefit |
| ---- | ------------ | -------------- |
| 1 | Stale inventory + rare jazz tradeoff | Extract preferences/constraints |
| 2 | Prioritized action plan | Prior prefs in synthesis context |
| 3 | Overclaim self-review | Session context triggers `self_review_overclaim` |
| 4 | Tagged 10-bullet plan | Tradeoffs retained without huge client prompt |

---

## Safety

| Control | Implementation |
| ------- | -------------- |
| Memory sanitizer | `sanitize_memory_text` — forbidden patterns, no JSON blobs |
| Max memory | 4000 chars; trim oldest summaries |
| TTL | 3600s per session |
| Reset | `POST /session/reset` |
| User isolation | `session_id` + `user_id` must match |
| No message bodies | Never extract or store raw negotiation text |

---

## Implementation files

| File | Role |
| ---- | ---- |
| `app/ai/session_memory.py` | Store, sanitizer, extractors, synthesis context |
| `app/ai/insights.py` | `session_start`, `session_query`, `session_get`, `session_reset` |
| `app/ai/routes.py` | HTTP routes |
| `tests/test_session_memory.py` | Unit + 4-turn flow tests |

---

## Boundaries

- No vector rollout
- No retrieval mode change
- No DB migration
- No webapp UI required for P21.3 (API prototype only)
- RAG card and seller panels unchanged

---

## Future (not P21.3)

- Redis-backed session store for multi-pod
- UI session indicator on `/insights`
- P21.4+ integration with seller intelligence panels
