# P21.6B — Non-vector latency acceptance

**Generated:** 2026-06-28  
**Implementation SHA:** (post P21.6A commit)  
**Design:** `docs/ai-platform/P21-6A-non-vector-latency-triage.md`

---

## Validation commands

| Step | Command | Result |
| ---- | ------- | ------ |
| Seller UI | `./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"` | **PASS** (4/4, seller-ready 4.0s) |
| Record intel | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"` | **PASS** (7/7, p95 UI 5.6s) |
| Longform | `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"` | **PASS** (12/12, p95 UI 5.4s) |
| Telemetry | `node scripts/ai-quality-telemetry-report.mjs` | **PASS** (0 WARNs) |
| OCH decontaminate | `bash scripts/rp-och-decontaminate-scan.sh` | **PASS** |

Deploy: `webapp:dev` rolled out to cluster before acceptance runs.

---

## Local artifacts (not committed)

| Artifact | Path |
| -------- | ---- |
| Seller latency JSON | `bench_logs/ai-platform/seller-intelligence-ui/20260628-034921/20260628-034921.json` |
| Record intel JSON | `bench_logs/ai-platform/ui-record-intelligence/20260628-034939/20260628-034939.json` |
| Longform JSON | `bench_logs/ai-platform/longform-rag-session/20260628-035017/20260628-035017.json` |
| Telemetry JSON | `bench_logs/ai-platform/quality-telemetry/20260628035056.json` |

---

## Required table

| Metric                        | Before P21.6 | After P21.6 | Threshold | Status |
| ----------------------------- | -----------: | ----------: | --------- | ------ |
| seller dashboard ready ms     |       26,196 |       4,031 | ≤15000    | PASS   |
| ui_latency_p95_ms             |       17,484 |       5,877 | ≤15000    | PASS   |
| endpoint_latency_p95_ms       |       16,038 |       5,680 | ≤12000    | PASS   |
| record_intelligence_avg_score |         3.86 |        3.86 | ≥3.5      | PASS   |
| longform_avg_score            |         3.67 |        3.67 | ≥3.5      | PASS   |
| leakage_pass                  |         true |        true | true      | PASS   |

---

## Per-panel latency (after)

| Panel | API ms | UI ready ms |
| ----- | -----: | ----------: |
| Listing advice | 2,936 | 4,070 |
| Negotiation strategy | 2,910 | 4,270 |
| Auction pressure | 2,885 | 4,335 |
| Collector metadata gaps | 2,916 | 4,385 |
| RAG card (deferred prefetch) | — | 5,321 |

---

## Telemetry WARNs

**None** — all P21.5 thresholds PASS after burn-down.

---

## Recommended next action

1. Keep deferred loading pattern; monitor weekly via `node scripts/ai-quality-telemetry-report.mjs`.
2. Optional future: seller batch endpoint or short TTL retrieval cache (no semantics change without design review).
3. **Do not** enable vector rollout.

---

## Final verdict

```text
P21.6 non-vector latency burn-down: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```

Quality and safety unchanged; latency WARNs cleared through webapp load sequencing — no retrieval default change.
