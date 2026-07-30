# T20.14G3 — Entity expansion v2 eval (3-run)

**Status:** Eval complete  
**Generated:** 2026-06-29  
**Deploy tag:** `python-ai-service:t20-p214g3`  
**Baseline SHA:** `b520ae8` (G3 implementation)

---

## Executive summary

G3 entity expansion v2 **improved doc/entity overlap from 7/16 → 8/16** on all three runs while preserving G2R latency and zero-result fixes. Entity expansion fired on **6/16** shadow runs. Overlap gate **≥10/16 not met** — recommend **G3R tuning** or gate reassessment before T20.14H.

Latency remains **well under SLO** (shadow p95 **106–260 ms**, cf p95 **60–70 ms**). True zero-results **0/16**. Product suites and contracts **PASS**.

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3R entity expansion tuning OR gate reassessment
```

---

## Timing table

| Metric | F2 baseline | G2R | G3 run 1 | G3 run 2 | G3 run 3 | Verdict |
| ------ | ----------: | --: | -------: | -------: | -------: | ------- |
| shadow p95 (ms) | 1494/376/1317 | 377/139/133 | **260** | **106** | **143** | **PASS** |
| candidate_fetch p95 (ms) | 557/205/532 | 91/66/62 | **70** | **60** | **67** | **PASS** |
| embed timeouts | 0 | 0 | 0 | 0 | 0 | **PASS** |
| true zero-results | 2/16 | 0/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| doc overlap >0 | 5/16 | 7/16 | **8/16** | **8/16** | **8/16** | **FAIL** (<10/16; improved) |
| entity overlap >0 | 5/16 | 7/16 | **8/16** | **8/16** | **8/16** | **FAIL** (<10/16; improved) |
| entity expansion added | n/a | n/a | **6/16** | **6/16** | **6/16** | info |
| keyword anchors added | n/a | 1/16 | **1/16** | **1/16** | **1/16** | info |
| source diagnostic | PASS | PASS | PASS | PASS | PASS | **PASS** |
| product telemetry WARNs | 0 | 0 | **0** | — | — | **PASS** |
| leakage | PASS | PASS | PASS | PASS | PASS | **PASS** |

### Run artifacts (local only — not committed)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-113011.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-113033.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-113045.md` |

---

## Overlap analysis

| Stage | doc/entity >0 | Notes |
| ----- | ------------- | ----- |
| F2 (HNSW baseline) | 5/16 | Pre-overlap v2 |
| G2 (fallback) | 7/16 | Zero-results fixed; latency regressed |
| G2R (latency cap) | 7/16 | Latency restored |
| **G3 (entity expansion)** | **8/16** | +1 run via sibling entity bridges |

Entity expansion active on **6/16** runs; remaining **8/16** zero-overlap primarily `source_type_mismatch` and `same_source_type_different_chunks` (unchanged chunk-overlap band).

Zero-overlap shadow runs: **8/16** (was 9/16 at G2R).

---

## C1 recovery (prerequisite)

`shopping-service` restored via `sync-redis-external-endpoints.sh` + rollout restart after Colima reboot Redis timeout. **1/1 Ready** before G3 work.

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
| `rp-rp-decontaminate-scan.sh` | PASS |
| Seller intelligence Playwright | PASS 4/4 |
| Record intelligence Playwright | PASS 7/7 avg 3.86 |
| Longform session Playwright | PASS 12/12 avg 3.67 |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## Decision

| Criterion | Met? |
| --------- | ---- |
| True zero-results → 0/16 | **Yes** |
| Latency gates | **Yes** |
| Doc/entity overlap ≥10/16 | **No** (8/16) |
| Rollout approval | **No** |

Per G3 eval rules:

- Overlap improved but **<10/16** → **G3R tuning** or gate reassessment
- Latency PASS → no rollback required
- **Not** ready for T20.14H 5-run stability

---

## Final verdict

```text
T20.14G3 entity expansion v2 eval: COMPLETE
Overlap: IMPROVED 7/16 → 8/16 (FAIL vs ≥10/16)
Latency: PASS
True zero-results: PASS (0/16)
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3R entity expansion tuning OR gate reassessment
```
