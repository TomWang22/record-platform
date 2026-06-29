# T20.14G3R — Overlap tuning eval

## Summary

G3R overlap anchor top-up **lifted anchored doc/entity overlap from 8/16 → 16/16** on all three runs while keeping **true zero-results at 0/16** and **product telemetry at 0 WARNs**. **Pure vector overlap remains 8/16** — unchanged from G3 — because all eight repaired cases required keyword overlap anchors, not additional vector/entity expansion alone. Keyword entity bridge fired **0/16** (anchors sufficient).

Latency: runs 2–3 **PASS** (shadow p95 **132 / 126 ms**). Run 1 shows a cold-embed tail (shadow p95 **1595 ms**) but remains under the **3000 ms** SLO. Candidate_fetch p95 **104 / 67 / 79 ms** — PASS.

**Decision:** Overlap gate is met only on the **anchored/hybrid** metric. Recommend **T20.14H-HYBRID-GATE** design — not pure vector rollout.

## Gate table

| Metric | G2R | G3 | G3R run 1 | G3R run 2 | G3R run 3 | Verdict |
| ------ | ---: | ---: | --------: | --------: | --------: | ------- |
| shadow p95 (ms) | 377/139/133 | 260/106/143 | **1595** | **132** | **126** | **PASS** (≤3000) |
| candidate_fetch p95 (ms) | 91/66/62 | 70/60/67 | **104** | **67** | **79** | **PASS** (≤1500) |
| true zero-results | 0/16 | 0/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| pure doc/entity overlap >0 | 7/16 | 8/16 | **8/16** | **8/16** | **8/16** | **FAIL** (<10/16) |
| anchored doc/entity overlap >0 | n/a | n/a | **16/16** | **16/16** | **16/16** | **PASS** (≥10/16) |
| overlap anchors added | n/a | n/a | **8/16** | **8/16** | **8/16** | info |
| entity expansion added | n/a | 6/16 | **6/16** | **6/16** | **6/16** | info |
| keyword entity bridge added | n/a | n/a | **0/16** | **0/16** | **0/16** | info |
| source diagnostic | PASS | PASS | **PASS** | **PASS** | **PASS** | **PASS** |
| product telemetry WARNs | 0 | 0 | **0** | **0** | **0** | **PASS** |
| leakage | PASS | PASS | **PASS** | **PASS** | **PASS** | **PASS** |

## Artifacts

| Run | JSONL | MD |
| --- | ----- | -- |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-115423.jsonl` | `...115423.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-115446.jsonl` | `...115446.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-115458.jsonl` | `...115458.md` |

- Implementation SHA: `cbe764a`
- Deploy image: `python-ai-service:t20-p214g3r`
- Source diagnostic: `bench_logs/ai-platform/t19-6-route-shadow-quality.md` — PASS
- Product telemetry: `bench_logs/ai-platform/quality-telemetry/20260629155553.md` — 0 WARNs

## Analysis

### Pure vs anchored split

| Path | Overlap >0 | Mechanism |
| ---- | ---------: | --------- |
| Pure vector + entity expansion | 8/16 | Unchanged from G3 — vector selection + G3 entity expansion |
| With overlap anchors | 16/16 | Eight zero-overlap cases repaired via `overlap_anchor_added` keyword refs |

All eight G3 zero-overlap cases received overlap anchors (`overlap_anchor_added: 8/16`). Keyword entity bridge did not add candidates (`0/16`) — keyword listing/revision refs were already present; anchors bridged doc/entity overlap directly.

### Latency note

Run 1 embed p95 **210 ms** (cold) vs runs 2–3 embed-cache-hot (**1 ms**). Shadow p95 **1595 ms** on run 1 is an embed-tail outlier, not anchor overhead (runs 2–3 with identical anchor counts show shadow p95 **~130 ms**).

## Decision logic

| Condition | Result |
| --------- | ------ |
| Pure doc/entity overlap ≥10/16 + latency PASS | **Not met** (8/16 pure) |
| Only anchored/hybrid overlap ≥10/16 | **Met** (16/16 anchored) |
| Latency regression | **Not met** — all runs under SLO |
| True zero-results | **PASS** 0/16 |

## Recommended next

**T20.14H-HYBRID-GATE** — design explicit hybrid/canary gate that reports pure vector overlap separately from anchor-assisted overlap before any rollout decision. Do **not** proceed with pure vector rollout on anchored-only pass.

Do **not** start T20.14H pure-vector path or T20.15 until hybrid gate design is approved.

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14H-HYBRID-GATE design (anchored overlap 16/16; pure overlap 8/16)
```
