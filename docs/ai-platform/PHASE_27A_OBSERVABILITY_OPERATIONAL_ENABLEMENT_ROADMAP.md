# Phase 27A — Observability operational enablement roadmap (design only)

**Phase 27A:** PASS — roadmap/design only  
**Phase 26:** CLOSED PASS (implementation `f09a9ef`; archive `6d13e83`; supersession `feb7e13`; supersession guard this batch)  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**DB writes:** NO  
**Migrations applied:** NO  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Feature flag enablement:** NOT PERFORMED  
**KPI writes:** NOT PERFORMED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  

This document is **design only**. It does not authorize live DB migration, flag enablement, KPI writes, live inference, production default changes, or PERCENT rollout.

---

## Why Phase 27

Phase 26 finished the **implementation** of KPI observability behind default-off gates. Rows are not operationally populated. Phase 27 is the controlled path to prove enablement **without** making hybrid/vector or KPI writes a production default.

Read first:

- `docs/ai-platform/ACTIVE_CONTEXT.md`
- `docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md`
- `docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md`

---

## Phase 27 final end state

```text
Phase 27 final end state:
- KPI observability can be enabled in a controlled, non-production-default path.
- KPI tables exist and remain redacted.
- All KPI write channels remain behind master/global/channel flags.
- A dev/staging-only enablement drill proves ingestion/searchability/query/usefulness rows can be populated safely.
- Combined KPI reports show PASS/PARTIAL/GAP honestly from actual rows.
- Disable switch drill proves all channels stop writing.
- No hybrid/vector production default is approved.
- No PERCENT rollout is approved.
- No live inference matrix is run unless separately approved.
- No raw response bodies, JWTs, passwords, private messages, proxy max bids, traces, DB dumps, bench logs, or generated reports are committed.
```

---

## Ticket plan (27A–27H)

| Phase | Scope | Allowed | Forbidden |
| ----- | ----- | ------- | --------- |
| 27A | Roadmap/design | docs only | live work |
| 27B | Local/dev DB migration apply verification | local/dev only, schema introspection | live DB migration |
| 27C | Dev/staging flag enablement drill | enable KPI flags only in controlled env | production enablement |
| 27D | Ingestion/searchability seed drill | tiny controlled non-sensitive fixture | reindex/backfill/live matrix |
| 27E | Query/usefulness observation smoke | minimal controlled smoke if explicitly approved | 57105 replay, production default |
| 27F | Combined KPI report from populated rows | /tmp reports only | committed generated reports |
| 27G | Disable switch rollback drill | prove writes stop | permanent enablement |
| 27H | Phase 27 closeout/archive | docs + verifier | production rollout |

### Ticket intents (detail)

**27A (this doc)** — Define end state, hard stops, approval phrases, and ticket gates. No runtime changes.

**27B** — Confirm `infra/db/48-ai-kpi-observability.sql` on local/dev `python_ai` @ `127.0.0.1:5440` (or documented equivalent). Introspect that the four `ai.ai_kpi_*` tables exist. Do **not** apply to live without owner-named target DB approval.

**27C** — In a named controlled env only, set:

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=0
AI_KPI_OBSERVABILITY_ENABLED=1
AI_KPI_*_ENABLED=1  # channels under test
```

Prove posture via tests/logs — not production ConfigMaps as permanent default.

**27D** — Tiny non-sensitive fixture (synthetic hashes/counters only) so ingestion/searchability tables get at least one redacted row each. No marketplace reindex, no participant artifact edits, no backfill.

**27E** — Optional minimal smoke for query/usefulness observation paths **only** if separately approved for that env. Forbidden: 57105 full-matrix replay, production default, PERCENT rollout.

**27F** — Run Phase 26F combined report against the controlled rows; output under `/tmp` only; do not commit generated JSON.

**27G** — Flip master disable / global off / channel offs; prove all `noop_write_kpi_*` paths stop inserting (reuse 26G drill spirit).

**27H** — Closeout docs + archive notes + verifier; reaffirm production posture unchanged.

---

## Phase 27 hard stops

```text
No production default switch
No PERCENT or ALLOW_PROD_PERCENT rollout
No hybrid/vector production default
No participant artifact edits
No user provisioning
No live 57105 replay
No bench log commits
No generated KPI report commits
No raw response bodies
No raw message bodies
No JWTs
No passwords
No proxy max bids
No live DB migration unless explicit owner approval names the target DB
```

Additional locked posture carried from Phase 26:

```text
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

---

## Gates and approval phrases

Each ticket starts only after the previous PASS and an explicit approval using these phrases:

```text
Approved: start Phase 27B local/dev KPI schema apply verification only after Phase 27A roadmap PASS — no live DB migration, no live eval, no production default, no PERCENT rollout.

Approved: start Phase 27C controlled dev/staging KPI flag enablement drill only after Phase 27B PASS — no production enablement, no live eval, no production default, no PERCENT rollout.

Approved: start Phase 27D controlled KPI row population drill only after Phase 27C PASS — non-sensitive fixture only, no reindex/backfill, no live matrix.

Approved: start Phase 27E controlled query/usefulness observation smoke only after Phase 27D PASS — no 57105 replay, no production default, no PERCENT rollout.

Approved: start Phase 27F combined KPI report from controlled rows only after Phase 27E PASS — output to /tmp only, no generated reports committed.

Approved: start Phase 27G KPI disable-switch rollback drill only after Phase 27F PASS — verify all channels stop writing.

Approved: start Phase 27H observability operational enablement closeout only after Phase 27G PASS.
```

---

## Non-goals (entire Phase 27)

```text
Not making keyword hybrid/vector the production default
Not raising PERCENT or ALLOW_PROD_PERCENT
Not broadening allowlists
Not provisioning users
Not editing participant artifacts
Not committing /tmp reports or bench logs
Not claiming model accuracy without ground truth
Not backfilling H1 full-matrix latency in committed docs unless separately approved
Not treating a successful enablement drill as permanent production write enablement
```

---

## Relationship to Phase 26

| Phase 26 deliverable | Phase 27 use |
| -------------------- | ------------ |
| Schema SQL + tables | 27B local/dev verify |
| Default-off write paths | 27C enable briefly; 27G disable |
| Extractors + combined report | 27F /tmp reports from rows |
| Disable-switch drill | 27G rollback proof |
| Archive + supersession | Read as current Phase 26 truth; do not reopen 26 |

---

## Verification for this design ticket

```bash
make ai-platform-verify-phase26-archive-supersession
make ai-platform-verify-phase26-observability
```

No live eval. No migrations. No flag flips.

---

## Next allowed step (after 27A PASS)

```text
Approved: start Phase 27B local/dev KPI schema apply verification only after Phase 27A roadmap PASS — no live DB migration, no live eval, no production default, no PERCENT rollout.
```
