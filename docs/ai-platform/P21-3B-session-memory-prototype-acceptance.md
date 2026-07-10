# P21.3B — Session memory prototype acceptance

**Generated:** 2026-06-27  
**Baseline SHA:** `432ef8f` (pre P21.3 commits)  
**Design:** `docs/ai-platform/P21-3A-session-memory-design.md`

---

## Run metadata

| Field | Value |
| ----- | ----- |
| Route | `/api/ai/session/*` (gateway → python-ai `/ai/session/*`) |
| Command | `cd services/python-ai-service && source .venv/bin/activate && PYTHONPATH=. python -m pytest tests/test_session_memory.py -v` |
| Full suite | `python -m pytest tests/ -q` → **211 passed** |
| Browser | N/A (API prototype; no webapp UI in P21.3) |
| Session test user | `u1` (mock DB corpus) |

Artifacts (local, not committed): pytest stdout; `bench_logs/ai-platform/*` from contract scripts.

---

## Endpoints

| Method | Path | Status |
| ------ | ---- | ------ |
| POST | `/api/ai/session/start` | Implemented |
| POST | `/api/ai/session/query` | Implemented |
| GET | `/api/ai/session/{session_id}` | Implemented |
| POST | `/api/ai/session/reset` | Implemented |

---

## 4-turn test

Prompts (same sequence as longform gauntlet turns 9→12 theme):

1. I care more about moving stale inventory than maximizing top dollar, but I do not want to undersell rare jazz records.
2. Based on my seller data, give me a prioritized action plan.
3. Review that plan for overclaims about rarity, buyer psychology, and auction urgency.
4. Give me a final 10-bullet plan tagged [grounded], [missing evidence], or [needs manual review].

| Turn | Template | turn_count | Preferences retained | Tags / tradeoffs |
| ---- | -------- | ---------: | -------------------- | ---------------- |
| 1 | `generic_grounded` | 1 | stale inventory pref extracted | — |
| 2 | `prioritized_action_plan` | 2 | yes | memory in synthesis context |
| 3 | `self_review_overclaim` | 3 | yes | overclaim review triggered via session context |
| 4 | `tagged_executive_summary` | 4 | yes | `[grounded]`, `[missing evidence]`, `[needs manual review]`; stale inventory + rare jazz bullets |

**session_id:** UUID v4 per `session/start` (persists across all 4 turns in test).

---

## Memory state summary (after turn 4)

| Field | Present |
| ----- | ------- |
| `preferences` | yes — includes stale inventory priority |
| `constraints` | yes — includes rare jazz undersell guard |
| `prior_summaries` | yes — up to 4 truncated answer summaries |
| `source_ref_ids` | yes — listing/obo refs from retrieval |
| `missing_evidence` | yes — synthesis caveats where applicable |
| `safety_notes` | yes — static “no message bodies stored” |

---

## Quality scores (prototype)

| Dimension | Score | Notes |
| --------- | ----- | ----- |
| Context retention | **good** | Turn 4 reflects turn 1 tradeoffs without client prompt accumulation |
| Tagged final plan | **PASS** | All three tag types present |
| Preference persistence | **PASS** | stale inventory + rare jazz in memory after turn 1 |
| Leakage | **PASS** | Forbidden strings absent in summaries + memory blob |
| Retrieval mode | **keyword** | Unchanged |
| model_used | **rule-engine** | Unchanged |

---

## Latency

| Metric | Value |
| ------ | ----- |
| 4-turn pytest (mock DB) | ~2.2 s |
| Full python-ai suite | ~30 s |

No production latency regression measured (API-only prototype; not wired to `/insights` UI).

---

## Leakage scan

Forbidden patterns checked per turn: `message_body`, `thread_text`, `private obo message`, `proxy_bids`, `max_bid_cents`.

**Result:** PASS

---

## Contracts

| Script | Result |
| ------ | ------ |
| `pytest tests/ -q` | 211 passed |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |

---

## Limitations

1. **In-memory only** — sessions lost on pod restart; not multi-pod safe
2. **No UI** — `/insights` still uses stateless panel fetches; session API is additive
3. **No DB persistence** — Redis/Postgres deferred to future ticket
4. **Turn 1 template** — generic until preferences extracted; tradeoff-specific template on explicit re-rank prompts
5. **Gateway contract audit** — session endpoints not yet in `audit-rp-ai-endpoints-contract.sh` manifest (additive; existing endpoints unchanged)

---

## Final verdict

```text
Phase 21 session memory prototype: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
