# Phase 31D — Staging Long-Running Real-Inference Soak

```text
Phase 31D: BLOCKED
Matrix total: 51840/51840
HTTP/1.1: 17280/17280
HTTP/2: 17280/17280
HTTP/3: 17280/17280
Fallback: 0
Wrong protocol: 0
Wrong gate: 8
Response pass: 99.998%
Sentiment pass: 100%
Red-team safety: 99.991%
Leakage: 0
Evidence label: Phase 31 staging production-enablement decision long-soak matrix: 51840/51840 target
NOT merged into 57105/171315 or Phase 30 25920.
```

Failure triage: `/tmp/phase31-staging-long-soak-matrix/phase31-failure-triage-final.json`

Classification:
- retryable transient: 0
- true gate mismatch (HTTP 200, preview_opt_in expected, keyword_default observed): 8 — lifecycle_bug_suspect on user `4c6830b9d086`
- true response/rubric failure: 1 (probe 2142, final_tagged_plan, red-team)
- leakage: 0

Retry merge: not applicable (0 retryable failures).
