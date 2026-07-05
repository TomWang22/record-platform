# Phase 22C — real-inference protocol-parity live matrix

**Status:** PASS  
**Validated:** 2026-07-05  
**Runner:** `scripts/phase22c-real-inference-protocol-parity-matrix.mjs`  
**Matrix duration:** ~41 minutes (7200 probes)

---

## Verdict

```text
Phase 22C: PASS — real-inference protocol-parity live matrix
Live matrix: RUN
Protocol matrix total: 7200/7200 HTTP 200
HTTP/1.1: 2400/2400
HTTP/2: 2400/2400
HTTP/3: 2400/2400
Fallback: 0
Wrong negotiated protocol: 0
keyword_default during matrix: 0
Response pass rate: 100%
Sentiment pass rate: 100%
Red-team safety pass rate: 100%
Leakage failures: 0
Gate counts: preview_opt_in=6000, allowlist=1200
Runtime/env changes: NONE
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
```

---

## Evidence separation (mandatory)

```text
Phase 21 matrix remains: 57105/57105 HTTP 200, 0% fallback — HTTP/1.1 live-runner stack only.
Phase 22B smoke: 15 read-only probes — NOT a live matrix.
Phase 22C protocol-parity matrix: 7200/7200 across HTTP/1.1, HTTP/2, HTTP/3.
Do not merge these numbers without labels.

Combined labeled evidence:
- Phase 21 HTTP/1.1 historical matrix: 57105/57105
- Phase 22C protocol-parity matrix: 7200/7200
```

---

## Matrix design

```text
3 protocols × 16 windows × 5 real/internal participants × 5 runs × 5 cases = 6000
3 protocols × 16 windows × 1 contract control × 5 runs × 5 cases = 1200
Total Phase 22C protocol-parity matrix = 7200 probes
```

| Protocol | Probes | HTTP 200 |
| -------- | ------ | -------- |
| HTTP/1.1 explicit | 2400 | 2400 |
| HTTP/2 | 2400 | 2400 |
| HTTP/3 | 2400 | 2400 |
| **Total** | **7200** | **7200** |

Participants (N=5 artifact): tom@example.com, tw5126@example.com, seed@example.com, phase21-preview-internal-1@example.com, phase21-preview-internal-2@example.com.

Contract control: e2e-contract@record-platform.local (`2ed75568-7deb-4c29-91b0-6919f24a0c9f`, allowlist only).

Cases: seller_listing_advice, buyer_sentiment, negotiation_strategy, auction_pressure, red_team_overclaim.

---

## Pre-live gates

| Gate | Result |
| ---- | ------ |
| Archive verification | PASS |
| Participant artifact audit (N=5 JWT) | PASS |
| Phase 22B validator smoke (15/15) | PASS |
| Env PERCENT=0, ALLOW_PROD_PERCENT=0 | PASS |
| Artifact SHA256 | `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa` |

---

## Latency baseline (rag_total_ms, curl end-to-end)

| Protocol | p50 | p95 | max |
| -------- | --- | --- | --- |
| HTTP/1.1 | 127.0 | 475.1 | 5535.9 |
| HTTP/2 | 124.1 | 504.7 | 5523.9 |
| HTTP/3 | 124.6 | 708.9 | 6335.8 |

Latency captured as baseline only; no timeout/non-200 failures.

---

## Assertions per probe

All 7200 probes verified: HTTP 200, negotiated protocol match, `hybrid_canary`, expected gate (`preview_opt_in` or `allowlist`), fallback=0, response/sentiment/red-team assertions, leakage=0.

---

## Output artifacts (local, not committed)

```text
bench_logs/ai-platform/phase22/phase22c-matrix-summary.json
bench_logs/ai-platform/phase22/phase22c-matrix.jsonl (redacted rows, no response bodies)
```

---

## Next step

Phase 22D rollback drill → Phase 22E KPI telemetry audit → Phase 22F decision → Phase 22G closeout.
