# T20.14E — Shadow latency 3-run re-eval

**Status:** Read-only evaluation  
**Generated:** 2026-06-28  
**Implementation SHA:** `a52baee` (T20.14D)  
**Deploy image:** `python-ai-service:t20-p214` (cluster tag; rebuild + rollout restart required after D commit)

---

## Executive summary

T20.14D **succeeded on observability gates**: embed timeouts **0/3 runs**, true zero-results **0/3 runs**, `shadow_fetch_attempted` **16/16** on all verified runs. One embed retry succeeded (run 1) without producing a false zero-result.

Latency **materially improved** vs T20.14A on median and best warm runs, but **rollout SLO remains unmet** on cold/warm tail runs (shadow p95 **5986–6399 ms** on runs 1–2). Candidate fetch p95 **still exceeds 1500 ms** on runs 1–2 (2066 ms, 3937 ms); run 3 (embed cache hot) shows cf p95 **616 ms**.

**Product path:** keyword contracts PASS; Playwright seller + record + longform PASS (record/longform passed on retry after transient RAG panel timeout); telemetry **0 WARNs**.

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14F ANN index ops design
```

---

## Deploy note

First three timing runs after D commit targeted `python-ai-service:dev` while the cluster deployment uses **`python-ai-service:t20-p214`**. Verified metrics below use three runs after rebuild/restart with `t20-p214` (artifacts `181105`, `181245`, `181454`).

---

## 3-run warm benchmark table

| Metric | T20.14A baseline | Run 1 | Run 2 | Run 3 | Verdict |
| ------ | ---------------: | ----: | ----: | ----: | ------- |
| shadow p95 (ms) | 9066 | **5986** | **6400** | **1034** | **FAIL** (runs 1–2); PASS run 3 (cache-hot) |
| embed p95 (ms) | 5321 | **3611** | **3264** | **6** | **WARN** (improved; run 3 cache-dominated) |
| candidate_fetch p95 (ms) | 4671 | **2066** | **3937** | **616** | **FAIL** runs 1–2 vs ≤1500; **PASS** run 3 |
| embed timeouts | 1 | **0** | **0** | **0** | **PASS** |
| true zero-results | 1/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| embed_timeout_before_fetch | 1 (implicit) | **0** | **0** | **0** | **PASS** |
| shadow_fetch_attempted | n/a | **16/16** | **16/16** | **16/16** | **PASS** |
| embed_retry attempted/succeeded | n/a | **1/1** | **0/0** | **0/0** | info — retry prevented false zero-result |
| default overlap zero (chunk) | 11/16 | **11/16** | **11/16** | **11/16** | info — unchanged |
| keyword contracts | PASS | **PASS** | **PASS** | **PASS** | **PASS** |
| Phase 21 telemetry WARNs | 1 | **0** | **0** | **0** | **PASS** |

### Run artifacts (local only)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-181105.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-181245.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-181454.md` |

---

## T20.14D observability assessment

| D1 goal | Result |
| ------- | ------ |
| Classify embed timeout vs true zero-result | **PASS** — `embed_timeout_before_fetch=0`, `true_zero_result=0` |
| Bounded embed retry | **PASS** — 1 retry succeeded in run 1; no infinite retry |
| shadow_fetch_attempted tracking | **PASS** — 16/16 on verified runs |

| D2 goal | Result |
| ------- | ------ |
| Global fetch cap `max_chunks*2` | **Deployed** — cf p50/p95 improved vs T20.14A on runs 1 & 3 |
| Tail cf still >1500 ms | **FAIL** on runs 1–2 — ANN / further trim candidate (T20.14F) |

---

## Comparison vs T20.14A

| Metric | T20.14A | Best verified (run 3) | Worst verified (run 2) | Direction |
| ------ | ------- | -------------------- | ----------------------- | --------- |
| shadow p95 | 9066 ms | 1034 ms | 6400 ms | improved (variance remains) |
| embed timeouts | 1 | 0 | 0 | **fixed** |
| zero-result shadow | 1/16 | 0/16 | 0/16 | **fixed** |
| candidate_fetch p95 | 4671 ms | 616 ms | 3937 ms | mixed — tail still fails |

---

## Product validation

| Check | Result |
| ----- | ------ |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-shadow-source-diagnostic.sh` | PASS |
| Seller intelligence Playwright | PASS 4/4 |
| Record intelligence Playwright | PASS 7/7 avg 3.86 (retry after transient timeout) |
| Longform session Playwright | PASS 12/12 avg 3.67 (retry) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## Decision logic

| Criterion | Met? |
| --------- | ---- |
| Embed timeouts → 0 | **Yes** (3/3 runs) |
| True zero-results → 0 | **Yes** (3/3 runs) |
| Shadow p95 ≤3000 ms (stable) | **No** (runs 1–2 still 6–6.4s) |
| candidate_fetch p95 ≤1500 ms | **No** on cold/warm tail (run 2 cf p95 3937 ms) |
| Rollout approval | **No** |

**T20.14D unlocks continued burn-down but does not approve rollout.**

---

## Recommended next steps

1. **T20.14F** — ANN index ops design (HNSW/IVFFlat, EXPLAIN before/after, rollback runbook) — primary path for candidate_fetch tail.
2. **T20.14G** — overlap v2 design (deferred until latency gates stabilize on repeated non-cache runs).
3. **T20.14H** — 5-run stability re-eval only after F-implemented improvements or justified cf SLO waiver.

Do **not** start T20.15.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14F ANN index ops design
```
