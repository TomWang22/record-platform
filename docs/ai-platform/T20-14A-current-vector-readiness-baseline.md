# T20.14A — Current vector readiness baseline

**Generated:** 2026-06-28  
**Baseline SHA:** `eb2ad90` (post P21.10A; release tag @ `b741f91`)  
**Release tag:** `rp-ai-phase-21-non-vector-seller-intelligence-20260628`  
**Method:** Read-only diagnostics only — no vector enablement, no indexes, no tranches

---

## Executive summary

Fresh warm shadow run (2026-06-28) confirms **keyword product path remains healthy** while **vector rollout stays blocked** on shadow latency, candidate fetch, embed variance, overlap parity, one zero-result shadow run, and Phase 21 telemetry WARN.

```text
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
Production retrieval remains keyword
```

---

## Commands executed (read-only)

| Script | Result | Artifact (local only) |
| ------ | ------ | --------------------- |
| `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 scripts/rp-ai-shadow-real-query-timing.sh` | complete | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-140942.md` |
| `scripts/rp-ai-shadow-source-diagnostic.sh` | PASS | `bench_logs/ai-platform/t19-6-route-shadow-quality.md` |
| `scripts/audit-rp-ai-rag-contract.sh` | PASS | `bench_logs/ai-platform/rag-ingestion-contract.md` |
| `scripts/rp-ai-rag-quality-smoke.sh` | PASS | `bench_logs/ai-platform/phase-17-rag-quality-smoke.md` |
| `scripts/audit-rp-ai-runtime-contract.sh` | PASS | `bench_logs/ai-platform/ai-runtime-provider-contract.md` |
| `scripts/audit-rp-ai-endpoints-contract.sh` | PASS | `bench_logs/ai-platform/python-ai-ollama-contract.md` |
| `scripts/rp-ai-provider-readiness.sh` | PASS | `bench_logs/ai-platform/phase-17-provider-readiness.md` |
| `scripts/rp-ai-pgvector-readiness.sh` | PASS | `bench_logs/ai-platform/phase-18-pgvector-readiness.md` |
| `scripts/rp-och-decontaminate-scan.sh` | PASS | `bench_logs/domain-comb/rp-och-code-comb.md` |
| Playwright seller intelligence UI | PASS 4/4 | `bench_logs/ai-platform/seller-intelligence-ui/20260628-181537/` |
| Playwright record intelligence | PASS 7/7 avg 3.86 | `bench_logs/ai-platform/ui-record-intelligence/20260628-181600/` |
| Playwright longform session | PASS 12/12 avg 3.67 | `bench_logs/ai-platform/longform-rag-session/20260628-181600/` |
| `node scripts/ai-quality-telemetry-report.mjs` | 1 WARN | `bench_logs/ai-platform/quality-telemetry/20260628181739.md` |

Supplemental read-only: `scripts/rp-ai-pgvector-query-plan-diagnostic.sh` → embedded count confirmation.

---

## Rollout gate table

| Gate | Target | Current | Status |
| ---- | ------ | ------- | ------ |
| Embedded count | ≥10k | **10,065** | **PASS** |
| Percent coverage | ≥15% optional | **~13.8%** (10,065 / 73,043 chunks) | **FAIL** (optional; count gate passes alternate) |
| Source diversity | ≥5 | **6** (auction_bid_summary, listing, listing_revision, notification, obo_offer_summary, record) | **PASS** |
| Owner-visible OBO | ≥10 | **18** (total embedded OBO: 1,544) | **PASS** |
| Shadow p95 | ≤3000 ms | **9066 ms** (warm run 20260628-140942) | **FAIL** |
| Embed p95 / timeouts | stable, 0 timeouts | p95 **5321 ms**; **1 timeout**, **2 outliers** ≥5s | **FAIL** |
| Candidate fetch p95 | ≤1500 ms preferred | **4671 ms** | **FAIL** |
| Zero-result shadow | 0 | **1/16** (default profile OBO query; embed timeout) | **FAIL** |
| Default overlap | meaningful vs keyword | chunk **5/16** doc>0; **11/16** zero chunk overlap | **FAIL** |
| Flagged overlap | diagnostic only | overlap flags default **off**; entity/doc overlap 5/16 on default+obo_owner run only | **PASS** (diagnostic-only posture) |
| Leakage | 0 | **0** (all Playwright + contract audits) | **PASS** |
| Keyword product quality | ≥3.5 | record intel **3.86**, longform **3.67** | **PASS** |
| Phase 21 product telemetry | 0 WARNs | **1 WARN** (`ui_latency_p95_ms` 21064 > 15000) | **FAIL** |

**Passing gates (8):** embedded count, source diversity, owner-visible OBO, flagged overlap posture, leakage, keyword quality, production keyword contracts, pgvector schema readiness.

**Failing gates (6 rollout-blocking + 1 optional):** shadow p95, embed stability, candidate fetch p95, zero-result shadow, default overlap, Phase 21 telemetry WARN; percent coverage optional FAIL.

---

## Shadow latency detail (T20.10 warm run)

| Metric | p50 | p95 |
| ------ | ---: | ---: |
| shadow total | 4531 ms | **9066 ms** |
| embed | 2666 ms | 5321 ms |
| candidate_fetch | 1696 ms | **4671 ms** |
| rerank_select | 6 ms | 15 ms |

Top contributors: `candidate_fetch_ms` up to **6012 ms**; one embed timeout on default-profile OBO query (**6439 ms** total, 0 selected).

Overlap: document-overlap >0 on **5/16** runs; entity-overlap >0 on **5/16**; zero-overlap reasons dominated by `same_source_type_different_chunks` (9).

Vector index on `embedding_vec`: **NONE** (exact sort at 10,065 rows).

---

## Product path detail (keyword)

| Check | Status |
| ----- | ------ |
| `retrieval_mode=keyword` default | PASS |
| `model_used=rule-engine` | PASS |
| Keyword stability (T19.6C) | 7/7 summaries unchanged |
| Seller intelligence UI | 4/4 panels, seller-ready **3174 ms** |
| Source refs / excerpts | 100% present |
| Session memory gauntlet | 12/12 turns, final score **4** |

---

## Comparison to Phase 20 closeout (T20.13K @ 066ef6e)

| Metric | T20.13K | T20.14A (today) | Delta |
| ------ | ------- | --------------- | ----- |
| Shadow p95 | ~8–10s | **9066 ms** | unchanged band — still FAIL |
| Embed timeouts | 0/7 harness | **1/16** shadow run | regression on one OBO default query |
| Candidate fetch p95 | ~2.5–3.9s | **4671 ms** | worse on tail |
| Default overlap | 1/7 chunk >0 | **5/16** doc>0 | slightly better on doc/entity axis |
| Keyword quality | 3.6 | **3.86** | improved (Phase 21 synthesis) |
| Embedded count | 10,065 | **10,065** | unchanged (no tranches) |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
Production retrieval remains keyword
```

**Next read-only step:** T20.14C — shadow latency implementation plan (design only).  
**Do not** start T20.14D implementation or T20.15 without T20.14H passing all gates.

See burn-down sequence: `docs/ai-platform/T20-14B-vector-rollout-gate-template.md`
