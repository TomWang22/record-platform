# Phase 31K — Preview Lifecycle Gate Root Cause

```text
Phase 31K: PASS
Phase 31: BLOCKED (parent)
Matrix completed: 51840/51840
Deterministic gate mismatch: 8
Retryable: 0
Triage artifact: /tmp/phase31-preview-lifecycle-triage.json
Source soak triage: /tmp/phase31-staging-long-soak-matrix/phase31-failure-triage-final.json
```

## Verdict

```text
Phase 31K: PASS
Root cause: Parallel matrix shards (h1/h2/h3) share global preview enrollment state. Each shard calls resetWindowEnrollments(revoke+enroll all preview users) at every window boundary without cross-shard coordination. When one shard starts a new window and revokes enrollments, another shard can be mid-window probing the same preview user, producing HTTP 200 + keyword_default despite expected preview_opt_in.
Affected user hash: 4c6830b9d086
Affected user (redacted): phas…@record-platform.local (real_participant preview; uid prefix b3d9d25b…)
Affected windows: 4, 17, 20, 22, 26, 29
Affected protocols: h1, h2, h3
Affected cases: auction_pressure, buyer_psychology, collector_metadata, final_tagged_plan, negotiation_strategy, pricing_strategy
Lifecycle bug confirmed: YES
Runner bug confirmed: YES
Service bug confirmed: NO
Data/user config bug confirmed: NO
Safe repair path: Serialize preview revoke/enroll across shards; pre-probe gate verify + fail-fast; JWT sub vs x-user-id check; keep deterministic gate mismatch BLOCKED; run 31M then 31N before 31E–31J.
```

## Eight failed-row triage table

| probe_id | protocol | window | run | case_id | expected_gate | observed_gate | http | retrieval_mode | response_pass | red_team |
| -------- | -------- | ------ | --- | ------- | ------------- | ------------- | ---- | -------------- | ------------- | -------- |
| 2142 | HTTP/3 | 4 | 8 | final_tagged_plan | preview_opt_in | keyword_default | 200 | keyword | FAIL | yes |
| 2154 | HTTP/3 | 4 | 10 | buyer_psychology | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 9164 | HTTP/2 | 17 | 9 | negotiation_strategy | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 9176 | HTTP/2 | 17 | 10 | collector_metadata | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 10786 | HTTP/1.1 | 20 | 9 | auction_pressure | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 11868 | HTTP/1.1 | 22 | 9 | pricing_strategy | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 14015 | HTTP/1.1 | 26 | 8 | negotiation_strategy | preview_opt_in | keyword_default | 200 | keyword | PASS | no |
| 15648 | HTTP/1.1 | 29 | 9 | pricing_strategy | preview_opt_in | keyword_default | 200 | keyword | PASS | no |

## Window context (affected user only)

Each affected window shows **88–89 PASS / 1–2 FAIL** out of 90 probes (9 cases × 10 runs). Failures cluster on **late runs (8–10)** with `retrieval_mode=keyword` while sibling probes in the same window return `preview_opt_in` + `hybrid_canary`.

| shard | window | wrong_gate | late_run_failures | runs with failures |
| ----- | ------ | ---------- | ----------------- | ------------------ |
| h3 | 4 | 2 | 2 | 8, 10 |
| h2 | 17 | 2 | 2 | 9, 10 |
| h1 | 20 | 1 | 1 | 9 |
| h1 | 22 | 1 | 1 | 9 |
| h1 | 26 | 1 | 1 | 8 |
| h1 | 29 | 1 | 1 | 9 |

## Ruled out

| Hypothesis | Result |
| ---------- | ------ |
| Missing preview enrollment at soak start | NO — same user passes 2872/2880 probes per shard |
| User revoked mid-window only on this account | PARTIAL — revoke happens globally when any shard resets window |
| Not enrolled in one shard only | NO — failures on all three shards |
| Enrolled under different user id | NO — single hash; artifact uid maps consistently |
| Auth/user-id mismatch | UNLIKELY — 99.98% pass rate for same uid |
| Stale token for entire soak | NO — failures are sparse/isolated, not session-wide |
| Retryable gateway transient | NO — all HTTP 200 with defined keyword_default gate |

## Commands

```bash
node scripts/phase31-preview-lifecycle-triage-readonly.mjs \
  --triage /tmp/phase31-staging-long-soak-matrix/phase31-failure-triage-final.json \
  --in /tmp/phase31-staging-long-soak-matrix \
  --out /tmp/phase31-preview-lifecycle-triage.json

node --test tests/phase31-preview-lifecycle-triage.test.mjs
```

Optional live lifecycle probe (local only, not committed):

```bash
node scripts/phase31-preview-lifecycle-triage-readonly.mjs --live
```

## Next phases

```text
Phase 31L: preview lifecycle repair implementation + tests (NOT STARTED)
Phase 31M: targeted replay after 31L PASS (NOT STARTED)
Phase 31N: full soak replay decision doc (NOT STARTED)
31E–31J: NOT RUN until matrix gates clean
```
