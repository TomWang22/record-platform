# T20.12D — Post–Tranche 4 readiness and live inference re-eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Baseline SHA:** `ccbaf70`  
**Tranche:** `t20-tranche-4` (+500 embeddings, 5,565 → 6,065)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **6,065** |
| Non-message chunks | 73,043 |
| Coverage | **≈8.3%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +3,935 |
| Gap to 15% (~10,957) | +4,892 |

## Gate results (post–Tranche 4)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 8.3% / 6,065 — improved from 7.62% / 5,565 but below rollout bar |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,268 total embedded OBO |
| Shadow p50/p95 (warm) | **CONDITIONAL** | 1,829 / 3,894 ms (T20.10T 2026-06-25) |
| Embed p50/p95 | **CONDITIONAL** | 988 / 2,845 ms; 0 timeouts on warm run |
| Default/off zero chunk-overlap | **FAIL** | 11/16 (unchanged pattern) |
| Flagged/on overlap | **DIAGNOSTIC** | Live inference variable; prior accepted case-02: 3/3/9 |
| Leakage | **PASS** | wrong_dim=0, message_embeddings=0, proxy_leaks=0 |
| Keyword stability | **PASS** | RAG quality smoke 5/5; keyword summary/refs stable in shadow diagnostic |
| Tranche rerun guard | **PASS** | Tranche 2/4 locks block (exit 2) |
| RAG contract | **PASS** | `audit-rp-ai-rag-contract.sh` |
| Quality smoke | **PASS** | `rp-ai-rag-quality-smoke.sh` |
| Runtime/endpoints | **PASS** | runtime + endpoints contract |
| Provider/pgvector | **PASS** | Ollama available; pgvector ready |
| OCH | **PASS** | `rp-och-decontaminate-scan.sh` |

### Shadow source diagnostic (T19.6C)

**RESULT: FAIL (3 issues)** — pre-existing diversity gaps, not introduced by Tranche 4:

- `record` not surfaced in hinted record/buyer profiles
- `hinted_union_types` only 4 types (need ≥5 when owner-visible)
- `hinted_types` regression vs route-weighted diversity

Keyword path and leakage checks within this script remain stable.

## Timing benchmark (warm, flags off)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-153030.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 1,829 / 3,894 |
| embed p50/p95 ms | 988 / 2,845 |
| candidate_fetch p50/p95 ms | 666 / 1,222 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 11/16 |

## Live inference transcript (v2 re-eval, local only)

Artifact (local): `bench_logs/ai-platform/live-inference/post-closeout-ai-inference-v2-20260625-153255.md`

### Production keyword (3 prompts)

| Case | model_used | retrieval | refs | leakage |
|------|------------|-----------|-----:|---------|
| catalog activity | rule-engine | keyword | 7 | PASS |
| seller notifications | rule-engine | keyword | 8 | PASS |
| negotiation context | rule-engine | keyword | 8 | PASS |

### Shadow flags-off (3 prompts)

All completed without embed timeout on this run. Chunk overlap 0/3; shadow types include `listing`, `notification`, `obo_offer_summary` on notifications prompt.

### Shadow flags-on (3 prompts)

Chunk overlap 0/3 on this run (embed variance); flags reset to 0/0 after pass.

### Structured endpoints (v1 raw reference)

6/6 non-empty; all `rule-engine`. No message bodies in outputs.

## What changed vs pre–Tranche 4

| Area | Change |
|------|--------|
| Embedded count | +500 (5,565 → 6,065) |
| Coverage | +0.7 pp (7.62% → 8.3%) |
| Production RAG | **Unchanged** — keyword + rule-engine |
| Vector default | **Unchanged** — off |
| Rollout verdict | **Unchanged** — NOT APPROVED |

Tranche 4 improved corpus coverage incrementally. It did **not** materially change overlap gates, shadow latency gates, or production answer generation.

## Final verdict

```text
Vector rollout: NOT APPROVED
Phase 20 remains CLOSED (hardening)
Production retrieval remains keyword
Phase 21: not started
```

Next bounded step: **T20.12E** Tranche 5 dry-run plan (`t20-tranche-5`). Actual write requires separate **T20.12F** approval.
