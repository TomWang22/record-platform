# Phase 28B — Observability Durability Harness and Guards

Offline/local durability harness and strict production-readiness guards. **Fixtures only** — no network, no kubectl, no live RAG, no production DB.

```text
Phase 28B: PASS — offline durability harness + guards
Phase 28C: NOT STARTED
Live eval run: NOT RUN
Runtime/env/default/allowlist changes: NONE
Production DB migration: NOT RUN
DB writes: NO
Real inference run: NOT RUN
Pipeline durability harness: PASS
H1/H2/H3 real protocol smoke: NOT RUN
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
Bench logs committed: NO
Generated reports committed: NO
Production default: keyword
PERCENT: 0
ALLOW_PROD_PERCENT: 0
Hybrid/vector production default: NOT APPROVED
```

---

## Harness pipeline (fixtures only)

Simulates the full observability pipeline without network:

```text
ingestion event
  → searchability check
  → query observations H1/H2/H3
  → usefulness observations H1/H2/H3/22C
  → combined KPI report (/tmp)
  → disable switch blocks writes
```

### Forbidden calls

The harness must **not** call:

```text
curl
kubectl
/api/ai/rag/query
/api/auth/login
psql against production
live DB URLs (unless explicitly passed in future 28C)
```

---

## Durability scenarios (16 cases)

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Happy path fixture rows | All child KPIs PASS |
| 2 | Missing ingestion rows | ingestion GAP / combined not full PASS |
| 3 | Missing searchability rows | searchability GAP |
| 4 | Missing query protocol | query_latency PARTIAL |
| 5 | Missing H3 usefulness | usefulness PARTIAL |
| 6 | Duplicate KPI event IDs | harness FAIL |
| 7 | Corrupt timestamp chain | arrival_to_searchable_ms validation FAIL |
| 8 | Negative rag_total_ms | query observation validation FAIL |
| 9 | Unknown protocol only | GAP for H1/H2/H3; cannot PASS |
| 10 | Forbidden private fields | validation FAIL |
| 11 | Evidence label drift (7200 parity / unlabeled 171315) | validation FAIL |
| 12 | Disable switch ON | all writes blocked |
| 13 | Global observability OFF | all writes blocked |
| 14 | Single channel flag OFF | that channel blocked |
| 15 | Report output outside /tmp | FAIL |
| 16 | Generated report committed in repo | guard FAIL |

---

## Guard failures

Phase 28 production-readiness guard fails if:

- 28A or 28B doc missing
- ACTIVE_CONTEXT does not mention Phase 28A/28B
- Doc must not claim production rollout approved
- Doc must not claim live eval run in 28A/28B
- Doc must not claim production DB migration run in 28A/28B
- Doc must not claim production KPI writes enabled by default
- Doc must not claim 28D/28E real inference ran before explicit approval
- Phase 22C 7200 described as full parity
- 171315 described as unlabeled cumulative
- Harness code contains curl, kubectl, /api/ai/rag/query, /api/auth/login
- Report output path is not /tmp by default
- Forbidden private fields in fixture/report output
- Generated KPI report JSON committed outside /tmp

---

## Runnable entrypoints

```bash
node scripts/phase28-observability-durability-harness-readonly.mjs
node scripts/phase28-observability-production-readiness-guard-readonly.mjs
node --test tests/phase28-observability-durability-harness.test.mjs
node --test tests/phase28-observability-production-readiness-guard.test.mjs
make ai-platform-verify-phase28-durability-harness
make ai-platform-verify-phase28-production-readiness
```

---

## Files

| File | Role |
| ---- | ---- |
| `scripts/lib/phase28-observability-durability-harness.mjs` | Core harness |
| `scripts/phase28-observability-durability-harness-readonly.mjs` | CLI self-check |
| `scripts/lib/phase28-observability-production-readiness-guard.mjs` | Guard library |
| `scripts/phase28-observability-production-readiness-guard-readonly.mjs` | Guard CLI |
| `tests/phase28-observability-durability-harness.test.mjs` | Scenario tests |
| `tests/phase28-observability-production-readiness-guard.test.mjs` | Guard tests |

---

## Next allowed step

```text
Approved: start Phase 28C local/dev KPI pipeline durability drill only after Phase 28B harness PASS — no live eval, no production DB migration, no production default, no PERCENT rollout.
```
