# Phase 32G — Timing-Attributed Repaired Long Soak

```text
Phase 32G: PASS (controlled staging soak)
Latency production-readiness gate: BLOCKED pending Phase 32H
Evidence label: Phase 32G timing-attributed repaired long-soak matrix: 51840/51840 target
Controlled real inference: RUN (completed)
Production/live eval: NOT RUN
Production enablement: NOT APPROVED
RCA status: REPRODUCED_AND_TRANSPORT_WAIT_LOCALIZED; underlying root cause unresolved
Phase 31 ~1,037,645 ms tier reproduced: YES (~1,008,863 ms max wall)
Phase 32H: IN PROGRESS (32H-A/B/C complete; remediation blocked until confirmed cause)
Soak evidence HEAD: 46bb0f0c372b0ad3c327731196c3027650275e67
Closeout docs commit: e25992e (+ correction follow-up)
```

## Verdict

| Gate | Result |
| ---- | ------ |
| Matrix soak (51840/51840, quality gates) | **PASS** |
| Latency production-readiness | **BLOCKED** pending Phase 32H |
| Production enablement | **NOT APPROVED** |

Phase 32G is a **valid controlled staging soak PASS**. The latency RCA is **not closed**.

The evidence **reproduced** the Phase 31 ~17-minute tier and **localized** the dominant delay to **curl `time_starttransfer` / pre-first-byte waiting** outside measured application RAG execution (~4 s server RAG on worst row). It did **not** establish the underlying network, gateway, proxy, host, or scheduling cause.

Do **not** describe this as fully explained, root-cause confirmed, network root cause proven, or production-ready.

Instrument note: matrix summarize may emit `RCA_REPRODUCED_ATTRIBUTED` when a timing component exceeds 80% of wall; stall analyzer `max_outlier_explained: false` is authoritative for production-readiness — **underlying layer not proven**.

## Closeout summary

| Item | Result |
| ---- | ------ |
| Soak evidence HEAD SHA | `46bb0f0c372b0ad3c327731196c3027650275e67` |
| Matrix | **51840/51840** (HTTP/1.1=17280, HTTP/2=17280, HTTP/3=17280) |
| wrong_gate / wrong_protocol / fallback / leakage | 0 |
| response / sentiment / red-team | 100% / 100% / 100% |
| timing coverage | 100% all fields |
| private-field leakage | PASS |
| `make ai-platform-verify-phase32g-long-soak` | PASS |
| stall analyzer | PASS (`max_outlier_explained: false`) |

## Evidence root

```bash
OUT=/tmp/phase32g-timing-attributed-repaired-long-soak
```

Stale pre-CI evidence isolated at `/tmp/phase32g-stale-pre-ci-cleanup-9495818-20260710-225311` — **not merged**.

Phase 32H correlation artifacts: `/tmp/phase32h-latency-root-cause/` (not committed).

## Extreme tier (Phase 32H-B findings)

With n=17,280 per protocol, **p99.99 wall ≈ 973,376–973,407 ms on all three protocols** — effectively the worst ~1–2 rows per shard, indicating **multiple synchronized extreme events**, not a single isolated maximum.

Phase 32H cross-protocol analysis (rows ≥60 s):

| Metric | Value |
| ------ | ----- |
| Extreme rows | 32 |
| Per protocol | H1=13, H2=8, H3=11 |
| Overlapping all-three-protocol clusters | 7 |
| Curl phase classification | 27 request-to-first-byte dominated; 5 client/process stall |

Worst row probe 11925 (HTTP/2): wall=1,008,863 ms; curl=1,008,312 ms; starttransfer≈curl; server_rag=4,213 ms; coordinator/KPI/retry not dominant.

## Latency distribution (wall ms by protocol)

| Protocol | p50 | p95 | p99 | p99.9 | p99.99 | max |
| -------- | --- | --- | --- | ----- | ------ | --- |
| HTTP/1.1 | 948 | 2473 | 5589 | 9344 | 973376 | 1,007,351 |
| HTTP/2 | 953 | 2519 | 5567 | 9834 | 973393 | **1,008,863** |
| HTTP/3 | 947 | 2450 | 5561 | 10290 | 973407 | 1,008,713 |

Typical experience (p50 ~950 ms, p95 ~2.5 s) is healthy. Extreme tail is **not** representative of p95/p99 but **must** be resolved before production enablement.

## Completion commands (executed)

```bash
node scripts/phase32g-summarize-long-soak.mjs --in "$OUT" --require-pass
node scripts/phase32f-stall-attribution-analyzer.mjs \
  --phase31 /tmp/phase31d-r2-repaired-staging-long-soak \
  --phase32d /tmp/phase32d-timing-attribution-micro-soak \
  --phase32e /tmp/phase32e-slow-kpi-write-durability \
  --phase32g "$OUT" \
  --out /tmp/phase32g-stall-attribution-analysis \
  --require-pass
make ai-platform-verify-phase32g-infra
make ai-platform-verify-phase32g-long-soak
```

## Next allowed step

**Phase 32H** — root-cause remediation and targeted reproduction track (`docs/ai-platform/PHASE_32H_LATENCY_ROOT_CAUSE_REMEDIATION.md`). Phase 32H-D remediation **blocked** until confirmed cause. Production default remains **keyword**, `PERCENT=0`, `ALLOW_PROD_PERCENT=0`.
