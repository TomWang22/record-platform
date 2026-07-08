# Phase 28A — Observability Production-Readiness Test Architecture

Production-readiness layer for KPI observability and real-inference durability. Phase 28A defines architecture, acceptance gates, and hard stops. Phase 28A/28B implement **offline** harnesses and guards only — no live eval, no production rollout.

```text
Phase 28A: PASS — production-readiness test architecture (docs + acceptance matrix)
Phase 28B: PASS — offline durability harness + strict guards (code/tests/fixtures)
Phase 28C: NOT STARTED
Live eval run: NOT RUN
Runtime/env/default/allowlist changes: NONE
Production DB migration: NOT RUN
DB writes: NO
Real inference run: NOT RUN
Pipeline durability harness: PASS (offline fixtures)
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

## 1. End goal for Phase 28

Phase 28 must prove KPI observability is **safe, testable, durable, and rollbackable** before any production rollout. It defines and implements stronger test gates than Phase 27. It covers:

- Real inference readiness (design + future controlled smoke)
- H1/H2/H3 protocol observability
- Ingestion/searchability durability
- Report correctness and redaction
- Failure behavior and disable-switch rollback

Phase 28 must **not** approve production default change, PERCENT rollout, production DB migration, or permanent KPI write enablement.

---

## 2. Phase 28A–28H ticket plan

| Phase | Scope | Must do real work? | Live/network? |
| ----- | ----- | ------------------: | -------------: |
| 28A | Production-readiness test architecture | docs + acceptance matrix | no |
| 28B | Offline/local harness + strict guards | yes: code/tests/fixtures | no |
| 28C | Local/dev pipeline durability drill | yes: DB rows + failure cases | local/dev DB only |
| 28D | Controlled real-inference observation smoke | yes, only if separately approved | controlled env only |
| 28E | H1/H2/H3 query-observation protocol verification | yes, only if separately approved | controlled env only |
| 28F | Pipeline durability soak: retry/idempotency/disable | yes | local/dev or approved staging only |
| 28G | Combined KPI report from durability evidence | yes | /tmp output only |
| 28H | Rollback/disable + archive closeout | yes | no production changes |

---

## 3. Exact hard stops

```text
Production default: keyword — NO CHANGE without explicit owner approval
Preview UI/API: KEEP
PERCENT=0 — NO CHANGE
ALLOW_PROD_PERCENT=0 — NO CHANGE
Hybrid/vector production default: NOT APPROVED
Production KPI enablement: NOT APPROVED
Production DB migration: NOT APPROVED
Live 57105 replay: NOT APPROVED
Bench logs committed: NO
Generated KPI reports committed: NO
kubectl mutations: NOT APPROVED in 28A/28B
curl to /api/ai/rag/query: NOT APPROVED in 28A/28B
Production ConfigMap/env permanent enablement: NOT APPROVED
```

Any doc or verifier claiming otherwise is a **guard failure**.

---

## 4. Real-inference readiness gates (future 28D/28E — design only)

Phase 28D controlled real-inference smoke requires **all** of:

- Explicit owner approval phrase
- Phase 21/22 archive verifiers PASS
- Phase 27 archive verifier PASS
- Phase 28B harness PASS
- Controlled env named in closeout doc
- KPI flags enabled only in that controlled env
- No production default change
- No PERCENT change
- No 57105 replay
- No production ConfigMap permanent enablement

### Future real-inference smoke shape (28D/28E)

```text
3 protocols × 5 cases × contract/controlled user path only
HTTP/1.1 explicit
HTTP/2 explicit
HTTP/3 explicit

For each probe:
  HTTP 200
  negotiated protocol exactly matches
  retrieval_mode captured
  gate_reason captured
  rag_total_ms captured
  fallback_count captured
  query observation row written
  usefulness observation row written from rubric metadata
  no raw prompt/response stored
  no leakage fields stored

Then generate /tmp combined KPI report.
Then disable switch and prove no more writes.
```

**Do not** add those probes to 57105/57105, 171315/171315, or Phase 22C 7200/7200. They are Phase 28 controlled smoke evidence only.

---

## 5. Pipeline durability gates (future 28C/28F)

Future local/dev durability drill (28C/28F):

```text
- Apply/idempotently verify schema on local/dev only
- Insert synthetic ingestion parent row
- Write ingestion event via official write path
- Write searchability check via official write path
- Verify arrival_to_searchable_ms is derived correctly
- Re-run same fixture and verify idempotency or duplicate handling
- Simulate partial embedding failure and verify PARTIAL report
- Simulate dead_letter_count and retry_count
- Simulate disable switch mid-run and verify remaining writes stop
- Generate /tmp report and verify child statuses
```

---

## 6. H1/H2/H3 observability gates

| Gate | Requirement |
| ---- | ----------- |
| Protocol coverage | HTTP/1.1, HTTP/2, HTTP/3 each have query observation samples for PASS |
| Partial coverage | Missing one protocol → query_latency PARTIAL, not PASS |
| Unknown protocol | Allowed as `unknown` only; cannot count toward H1/H2/H3 PASS |
| Negotiated protocol | Future 28E must match probe transport exactly |
| Latency | `rag_total_ms` non-negative; corrupt values fail validation |

---

## 7. Redaction/privacy gates

Forbidden fields in fixtures, reports, and committed artifacts:

```text
response_body, raw_response_body, message_body, raw_message_body,
jwt, token, password, proxy_max_bid, private_message, authorization_header
```

Combined report must pass `assertArtifactRedacted`. Evidence labels must not drift:

- Phase 22C 7200/7200 is **sample only** — never full parity
- 171315/171315 is **labeled H1+H2+H3 only** — never unlabeled cumulative

---

## 8. Disable-switch rollback gates

| Switch | Effect |
| ------ | ------ |
| `AI_KPI_MASTER_DISABLE=true` | All KPI writes blocked |
| `AI_KPI_OBSERVABILITY_ENABLED=false` | All KPI writes blocked |
| Per-channel flag OFF | That channel blocked; others testable independently |

28B harness simulates these gates offline. 28G will prove rollback on real write paths.

---

## 9. Report correctness gates

| Scenario | Expected child status |
| -------- | --------------------- |
| Complete fixture rows | ingestion/searchability/query/usefulness PASS |
| Missing ingestion | ingestion GAP |
| Missing searchability | searchability GAP |
| Missing one query protocol | query_latency PARTIAL |
| Missing H3 usefulness | usefulness PARTIAL |
| Duplicate event IDs | harness validation FAIL |
| Output path not under /tmp | FAIL |
| Generated report committed to repo | guard FAIL |

Report output defaults to `/tmp` only. No generated reports committed.

---

## 10. Future approval phrases for 28C–28H

```text
Approved: start Phase 28C local/dev KPI pipeline durability drill only after Phase 28B harness PASS — no live eval, no production DB migration, no production default, no PERCENT rollout.

Approved: start Phase 28D controlled real-inference observability smoke only after Phase 28C durability PASS — no 57105 replay, no production default, no PERCENT rollout, no production KPI enablement.

Approved: start Phase 28E H1/H2/H3 query observation protocol smoke only after Phase 28D PASS — controlled env only, no 57105 replay, no production default, no PERCENT rollout.

Approved: start Phase 28F KPI durability report from controlled evidence only after Phase 28E PASS — output to /tmp only, no generated reports committed.

Approved: start Phase 28G disable-switch rollback drill only after Phase 28F PASS — prove all KPI write channels stop.

Approved: start Phase 28H observability production-readiness closeout only after Phase 28G PASS.
```

---

## Verifier

```bash
make ai-platform-verify-phase28-production-readiness
```

Chains Phase 27 archive verifier, Phase 28 guard, and Phase 28B durability harness tests.

---

## Code map

| Artifact | Purpose |
| -------- | ------- |
| `scripts/lib/phase28-observability-durability-harness.mjs` | Offline pipeline simulation |
| `scripts/lib/phase28-observability-production-readiness-guard.mjs` | Doc/harness guards |
| `tests/phase28-observability-durability-harness.test.mjs` | 16 durability scenarios |
| `tests/phase28-observability-production-readiness-guard.test.mjs` | Guard unit tests |
