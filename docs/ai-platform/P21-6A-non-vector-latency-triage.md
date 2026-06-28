# P21.6A — Non-vector latency triage

**Phase:** 21 — non-vector product track  
**Baseline:** `4b959b4`  
**Status:** Triage complete, optimizations implemented

---

## Baseline (pre P21.6)

From P21.5 telemetry (`20260628014320.json`) and fresh seller UI run:

| Metric | Value | Status |
| ------ | ----: | ------ |
| ui_latency_p95_ms | 17,484 | WARN |
| endpoint_latency_p95_ms | 16,038 | WARN |
| seller dashboard (page → 4 panels) | ~26,196 | — |
| record_intelligence p95 UI | 17,484 | buyer_psychology outlier |
| longform p95 UI | 22,878 | prioritized_action_list outlier |

### Top slow cases (pre-change)

| Source | Case / turn | UI ms | API ms | Notes |
| ------ | ----------- | ----: | -----: | ----- |
| Record intel | buyer_psychology | 17,484 | 17,303 | RAG query under load |
| Longform | turn 2 prioritized_action_list | 22,878 | — | Same page, 10+ concurrent API calls |
| Seller UI | full page | 26,196 | ~0* | Blocked on RAG + 6 secondary panels before seller-ready signal |

\* Playwright `request.timing()` returned 0; wall-clock panel wait dominated.

### Root causes

1. **Dashboard gate:** `ai-insights-dashboard` awaited `Promise.all([RAG, valuation, pricing, OBO, auction, seller summary, buyer])` before setting `dashboardReady` — seller panels rendered but competed with 7+ simultaneous python-ai calls.
2. **RAG on critical path:** Auto-loaded RAG (~14s edge latency) on mount alongside seller structured endpoints (4× keyword retrieval).
3. **DOM order:** RAG card rendered above seller intelligence section — visual priority inverted vs product path.
4. **No seller-ready signal:** Tests waited for full dashboard + RAG; no isolated seller dashboard metric.
5. **Backend:** Four structured seller endpoints each run independent `retrieve_chunks` — expected for separate HTTP contracts; not changed (no retrieval semantics change).

---

## Changes made

### Webapp — `ai-insights-dashboard.tsx`

- **Decouple `dashboardReady`** from AI panel fetches; set after context IDs load only.
- **Defer secondary panels** (valuation, pricing, OBO, auction, seller/buyer summary) via `requestIdleCallback` (2.5s timeout fallback).
- **Defer RAG prefetch** via `requestIdleCallback` (4s timeout) — no longer blocks first paint or seller panels.
- **Reorder layout:** `SellerIntelligencePanels` above RAG card.

### Webapp — `seller-intelligence-panels.tsx`

- **Staggered load:** listing advice + auction pressure immediately; negotiation + collector metadata on idle (750ms cap).
- **`seller-dashboard-ready`** testid when all four panels resolve.

### E2E — `seller-intelligence-ui.spec.ts` + helper

- Per-panel **api_ms** (wall-clock request→response), **ui_ready_ms**, artifact JSON under `bench_logs/ai-platform/seller-intelligence-ui/`.
- Metrics: page_ready_ms, seller_dashboard_ready_ms, rag_ready_ms.

### Telemetry — `ai-quality-telemetry-report.mjs`

- Reads seller-intelligence artifact: `seller_dashboard_ready_ms`, `seller_panel_api_p95_ms`, `rag_ready_ms`.
- Merges seller panel API timings into aggregate latency.

---

## Before / after (local, post-deploy)

| Metric | Before P21.6 | After P21.6 |
| ------ | -----------: | ----------: |
| seller_dashboard_ready_ms | ~26,196 | **4,031** |
| rag_ready_ms | (blocked ~26s+) | **5,321** |
| seller panel API p95 | n/a | **2,936** |
| ui_latency_p95_ms (telemetry) | 17,484 | **5,877** |
| endpoint_latency_p95_ms | 16,038 | **5,680** |
| record_intelligence p95 UI | 17,484 | **5,574** |
| longform p95 UI | 22,878 | **5,429** |

Quality unchanged: record 3.86, longform 3.67, final turn 4.0, leakage PASS.

---

## Per-panel latency (post-change seller run)

| Panel | API ms | UI ready ms |
| ----- | -----: | ----------: |
| Listing advice | 2,936 | 4,070 |
| Negotiation strategy | 2,910 | 4,270 |
| Auction pressure | 2,885 | 4,335 |
| Collector metadata | 2,916 | 4,385 |

---

## Non-goals

- No vector retrieval or embedding tranches.
- No change to keyword retrieval default or rule-engine synthesis.
- No batch seller endpoint (would change API contract).
- No hiding errors or removing source evidence.
- No generative Ollama as production default.

---

## Vector rollout

**NOT APPROVED** — T20.14/T20.15 remain **BLOCKED**.

---

## Remaining gaps

- Four structured endpoints still perform independent DB retrievals (~3s each) — acceptable for non-vector path; batch/cache is future work.
- RAG prefetch still runs after idle (~5s) — user can query manually sooner.
- ui-inference artifact in telemetry aggregate is stale (pre-P21.6); refresh separately if needed.
