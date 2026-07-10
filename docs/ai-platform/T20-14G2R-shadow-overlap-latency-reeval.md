# T20.14G2R — Shadow overlap latency re-eval (3-run)

**Status:** Eval complete  
**Generated:** 2026-06-29  
**Deploy tag:** `python-ai-service:t20-p214g2r`  
**Baseline SHA:** `d3e7a63` (G2R implementation)

---

## Executive summary

G2R **restored latency gates** while keeping G2's zero-result fix. All three runs show shadow p95 and candidate_fetch p95 **well under SLO** (vs G2 regression 6779/6158/3153 ms shadow). True zero-results remain **0/16**; doc/entity overlap stable at **7/16** (improved vs F2 5/16, still below ≥10/16 target).

Anchor-first fallback confirmed on catalog query: `keyword_anchor_first` + `global_retry_skipped=safe_keyword_anchors_available` (2 anchors, no global retry).

**Caveat:** Runs 2–3 are embed-cache-hot (embed p95 **0.2 ms**). Run 1 is colder (embed p95 **234 ms**) and is the more representative non-cache tail — still **PASS** (shadow p95 **377 ms**, cf **91 ms**).

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3 entity expansion v2
```

---

## Timing table

| Metric | F2 baseline | G2 eval | G2R run 1 | G2R run 2 | G2R run 3 | Verdict |
| ------ | ----------: | ------: | --------: | --------: | --------: | ------- |
| shadow p95 (ms) | 1494/376/1317 | 6779/6158/3153 | **377** | **139** | **133** | **PASS** |
| candidate_fetch p95 (ms) | 557/205/532 | 1251/3241/1011 | **91** | **66** | **62** | **PASS** |
| embed timeouts | 0 | 0 | 0 | 0 | 0 | **PASS** |
| true zero-results | 2/16 | 0/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| true zero after fallback | n/a | 0/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| doc overlap >0 | 5/16 | 7/16 | **7/16** | **7/16** | **7/16** | **FAIL** (<10/16) |
| entity overlap >0 | 5/16 | 7/16 | **7/16** | **7/16** | **7/16** | **FAIL** (<10/16) |
| keyword anchors added | n/a | 1/16 | **1/16** | **1/16** | **1/16** | info |
| global retry skipped | n/a | n/a | **1/16** | **1/16** | **1/16** | info |
| source diagnostic | PASS | PASS | PASS | PASS | PASS | **PASS** |
| product telemetry WARNs | 0 | 1 | **0** | — | — | **PASS** |
| leakage | PASS | PASS | PASS | PASS | PASS | **PASS** |

### Run artifacts (local only — not committed)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-111624.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-111644.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-111656.md` |

---

## G2R vs G2 latency comparison

| Layer | G2 run 1 (worst) | G2R run 1 (coldest) | Delta |
| ----- | ----------------: | ------------------: | ----- |
| shadow p95 | 6779 ms | 377 ms | **−94%** |
| candidate_fetch p95 | 1251 ms | 91 ms | **−93%** |
| embed p95 | 4339 ms | 234 ms | **−95%** |

Primary driver: **anchor-first** (skip global untyped retry when 2 safe keyword anchors available) + **capped global retry** `min(4, max_chunks)` + **OBO floor without broad fanout**.

---

## Fallback telemetry (run 1)

Catalog zero-result path (`shadow_default`):

- `zero_result_fallback_stage`: `keyword_anchor_first`
- `global_retry_skipped`: true
- `global_retry_skip_reason`: `safe_keyword_anchors_available`
- `keyword_anchor_count`: 2
- `vector_only_zero_result`: true (preserved)

Notification path: OBO floor satisfied via typed fetch; no fallback needed.

---

## C0 recovery notes

- Colima restarted after macOS update (`colima start --kubernetes`)
- HNSW index and 10,065 embeddings **survived**
- Post-restart: `nomic-embed-text` re-pulled into Ollama (init container had only `llama3.2:1b`)
- Cluster image verified: `python-ai-service:t20-p214g2r`

---

## Contract and product validation

| Check | Result |
| ----- | ------ |
| `rp-ai-shadow-source-diagnostic.sh` | PASS |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |
| Seller intelligence Playwright | PASS 4/4 |
| Record intelligence Playwright | PASS 7/7 avg 3.86 |
| Longform session Playwright | PASS 12/12 avg 3.67 |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## Decision

| Criterion | Met? |
| --------- | ---- |
| True zero-results → 0/16 | **Yes** |
| Latency gates (shadow ≤3000, cf ≤1500 all runs) | **Yes** |
| Doc/entity overlap ≥10/16 | **No** (7/16) |
| Rollout approval | **No** |

Per G2R eval rules:

- True zero remains 0/16 **and** latency re-PASS → **T20.14G3 entity expansion v2**
- Overlap <10/16 → **not** T20.14H yet
- Do **not** approve vector rollout

---

## Final verdict

```text
T20.14G2R shadow overlap latency re-eval: COMPLETE
Latency: PASS (restored vs G2 regression)
True zero-results: PASS (0/16)
Overlap: FAIL (7/16 doc/entity — unchanged from G2)
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3 entity expansion v2
```
