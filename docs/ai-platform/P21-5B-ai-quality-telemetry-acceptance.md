# P21.5B — AI quality telemetry acceptance

**Generated:** 2026-06-28  
**Baseline SHA:** `edf0f11` (P21.5A reporter)  
**Design:** `docs/ai-platform/P21-5A-ai-quality-telemetry-design.md`

---

## Validation commands

| Step | Command | Result |
| ---- | ------- | ------ |
| Seller UI | `./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"` | **PASS** (4/4 panels, 19s) |
| Record intel | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"` | **PASS** (7/7, avg 3.86, 1.1m) |
| Longform gauntlet | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"` | **PASS** (12/12, avg 3.67, final 4.0, 1.9m) |
| Telemetry reporter | `node scripts/ai-quality-telemetry-report.mjs` | **PASS** (report written) |
| OCH decontaminate | `bash scripts/rp-och-decontaminate-scan.sh` | **PASS** |

Seller panel stamp after UI run: `node scripts/ai-quality-telemetry-report.mjs --stamp seller-intelligence:4`

E2E note: seller spec RAG wait aligned to 120s (RAG edge latency ~14s; prior 5s default caused 504 flake).

---

## Local report paths

| Artifact | Path |
| -------- | ---- |
| Markdown report | `bench_logs/ai-platform/quality-telemetry/20260628014320.md` |
| JSON summary | `bench_logs/ai-platform/quality-telemetry/20260628014320.json` |

Fresh Playwright artifacts (local, not committed):

- `bench_logs/ai-platform/ui-record-intelligence/20260628-013948/20260628-013948.json`
- `bench_logs/ai-platform/longform-rag-session/20260628-014114/20260628-014114.json`

---

## Scorecard

| Metric                        | Value | Threshold | Status |
| ----------------------------- | ----: | --------- | ------ |
| record_intelligence_avg_score |  3.86 | ≥3.5      | PASS   |
| longform_avg_score            |  3.67 | ≥3.5      | PASS   |
| final_turn_score              |  4.00 | ≥4.0      | PASS   |
| leakage_pass                  |  true | true      | PASS   |
| source_refs_present_rate      |  1.00 | ≥0.95     | PASS   |
| source_excerpt_present_rate   |  1.00 | ≥0.80     | PASS   |
| ui_latency_p95_ms             | 17484 | ≤15000    | WARN   |
| endpoint_latency_p95_ms       | 16038 | ≤12000    | WARN   |

Additional metrics from JSON summary:

| Metric | Value |
| ------ | ----: |
| seller_panels_passed | 4/4 |
| forbidden_hit_count | 0 |
| old_boilerplate_regression | false |
| collector_completeness_score (avg) | 36 |
| session_memory_turn_count | 12 |
| session_memory_context_retention | good |
| structured_endpoint_pass | 10/10 |
| endpoint_http_200 | 26/26 |

---

## WARNs

1. **ui_latency_p95_ms** — 17484 ms (threshold ≤15000). Driven by record-intelligence `buyer_psychology` (17.5s UI) and longform turn 2 `prioritized_action_list` (22.9s UI).
2. **endpoint_latency_p95_ms** — 16038 ms (threshold ≤12000). Same slow turns; RAG query edge latency ~14s observed on cold path.

WARNs are **non-blocking** per P21.5A design (telemetry visibility, not CI gate).

---

## Leakage / safety

- All artifact rows: `leakage_result: PASS`
- `forbidden_hit_count: 0`
- OCH decontaminate scan: **PASS**
- No message bodies in reports or UI artifacts

---

## Recommended next action

1. **Monitor latency** — track p95 UI/API in weekly telemetry runs; investigate python-ai-service / edge timeout if p95 stays above thresholds.
2. **Refresh contract audit** — re-run `scripts/audit-rp-ai-endpoints-contract.sh` before production checks (current sample from 2026-06-27).
3. **Optional:** add seller-intelligence JSON artifact writer (remove stamp workaround).
4. **Do not** enable vector rollout — continue Phase 21 non-vector product track.

---

## Final verdict

```text
P21.5 AI quality telemetry: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```

Quality scores and safety gates pass. Latency WARNs documented for ongoing monitoring — consistent with P21.5 WARN-only threshold policy.
