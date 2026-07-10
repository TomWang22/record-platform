# P21.5A — AI quality telemetry design

**Phase:** 21 — non-vector product track  
**Baseline:** `4ae294e`  
**Status:** Design + local reporter implemented

---

## Goal

Provide ongoing visibility into AI product quality and latency for the Phase 21 seller-intelligence path without enabling vector retrieval or T20.14/T20.15 work.

---

## Reporter

| Item | Value |
| ---- | ----- |
| Script | `scripts/ai-quality-telemetry-report.mjs` |
| Tests | `scripts/ai-quality-telemetry-report.test.mjs` (`node --test scripts/ai-quality-telemetry-report.test.mjs`) |
| Output dir | `bench_logs/ai-platform/quality-telemetry/<timestamp>.{md,json}` |
| Stamp file | `bench_logs/ai-platform/quality-telemetry/stamps.json` (optional, local) |

Run:

```bash
node scripts/ai-quality-telemetry-report.mjs
node scripts/ai-quality-telemetry-report.mjs --stamp seller-intelligence:4
```

---

## Artifact sources

Reads the **latest** session JSON under each directory (by file mtime):

| Source | Path pattern |
| ------ | ------------ |
| Record intelligence | `bench_logs/ai-platform/ui-record-intelligence/<ts>/<ts>.json` |
| Longform gauntlet | `bench_logs/ai-platform/longform-rag-session/<ts>/<ts>.json` |
| UI RAG inference | `bench_logs/ai-platform/ui-inference/<ts>/<ts>.json` |
| Seller intelligence UI | `bench_logs/ai-platform/seller-intelligence-ui/<ts>/<ts>.json` (optional future) |
| Endpoint contract audit | `bench_logs/ai-platform/python-ai-ollama-contract.json` |

Playwright specs write record/longform/inference artifacts today. Seller panel pass count uses `--stamp seller-intelligence:4` after the seller UI spec until a dedicated artifact writer exists.

---

## Metrics

| Metric | Source |
| ------ | ------ |
| `record_intelligence_avg_score` | Record intel aggregate `avg_domain_score` |
| `longform_avg_score` | Longform aggregate `avg_score` |
| `final_turn_score` | Longform aggregate `final_turn_score` |
| `seller_panels_count` | Constant `4` |
| `seller_panels_passed` | Stamp or seller-intelligence artifact |
| `endpoint_http_200_count` | Sum of HTTP 200 across artifact rows |
| `endpoint_latency_p50/p95_ms` | Network/API ms from artifacts |
| `ui_latency_p50/p95_ms` | UI total ms from artifacts |
| `leakage_pass` | All rows + aggregates leakage PASS |
| `forbidden_hit_count` | Regex scan (no message bodies stored) |
| `source_refs_present_rate` | Rows with `refs_count > 0` |
| `source_excerpt_present_rate` | Rows with API/response excerpt present |
| `collector_completeness_score` | Avg parsed `Completeness score: N/100` |
| `session_memory_turn_count` | Longform turn count or contract sample |
| `session_memory_context_retention` | Longform `context_retention_turns_9_12` |
| `synthesis_template_counts` | Histogram from artifact rows |
| `old_boilerplate_regression` | Any old boilerplate flag in artifacts |
| `structured_endpoint_*` | Contract audit `checks` array |

---

## Thresholds (WARN only — not CI-blocking for P21.5)

| Metric | Threshold | Failure |
| ------ | --------- | ------- |
| `record_intelligence_avg_score` | ≥ 3.5 | WARN |
| `longform_avg_score` | ≥ 3.5 | WARN |
| `final_turn_score` | ≥ 4.0 | WARN |
| `leakage_pass` | `true` | WARN |
| `old_boilerplate_regression` | `false` | WARN |
| `source_refs_present_rate` | ≥ 0.95 | WARN |
| `source_excerpt_present_rate` | ≥ 0.80 | WARN |
| `ui_latency_p95_ms` | ≤ 15000 | WARN |
| `endpoint_latency_p95_ms` | ≤ 12000 | WARN |

---

## Report sections

1. Executive status  
2. Scorecard (threshold table)  
3. Latency table  
4. Endpoint health  
5. Source evidence coverage  
6. Leakage / safety  
7. Template distribution  
8. Session memory state  
9. Regressions  
10. Recommended next actions  

---

## Local-only output policy

- Reports and stamps live under `bench_logs/` — **never committed**.
- Pre-commit guard rejects staged `bench_logs/`, screenshots, traces, dumps.
- Reporter does not expose message bodies; forbidden-term scan operates on existing artifact answer text only.

---

## Observability alignment

Follows the same local bench + observation-deck pattern as preflight (`bench_logs/preflight-results.json` → `/observation-deck`). P21.5 adds a **domain-specific** quality layer for AI product acceptance rather than extending Grafana in this ticket.

Future option (not in scope): feed JSON summary into observation-deck API or Grafana dashboard panels.

---

## Hard rules (unchanged)

- **Do not** enable vector retrieval or change retrieval default.
- **Do not** start T20.14/T20.15 or embedding tranches.
- **Do not** expose message bodies in UI or reports.
- Production remains **keyword + rule-engine** (`model_used=rule-engine`).

---

## Vector rollout

**NOT APPROVED** — T20.14/T20.15 remain **BLOCKED**.
