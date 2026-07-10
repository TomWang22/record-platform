# T20.13U — Protocol + pipeline RAG acceptance

**Generated:** 2026-06-27  
**Baseline SHA:** `dac8b72` (includes T20.13T auction fix)  
**Prior:** T20.13R/S record-intelligence UI acceptance  
**Artifacts (local, not committed):**

- `bench_logs/ai-platform/ui-protocol-pipeline/20260627-034139/`
- `bench_logs/ai-platform/ui-record-intelligence/20260627-034347/`
- `bench_logs/ai-platform/ui-inference/` (generic UI rerun)

---

## Executive result

```text
Protocol + pipeline RAG acceptance: PARTIAL
HTTP/2: PASS
HTTP/3: PASS
Browser UI RAG: PASS
Record intelligence UI: PARTIAL
Event pipeline: PARTIAL
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Summary:** T20.13T fixed the auction psychology HTTP 500 crash. Edge serves HTTP/2 and HTTP/3 with `alt-svc`. Browser RAG path uses **h2** (`nextHopProtocol`). Generic UI RAG **7/7 PASS**. Record intelligence **7/7 render** with auction scenario recovered (score 4.0); average domain score **3.21** (up from 2.93) still below 3.5 soft target due to collector/action-plan depth. Event layer proto contracts PASS; Kafka producer/consumer audit PASS; partition verify skipped (no local compose Kafka). AI RAG path is **synchronous** — no event completion dependency.

---

## U1 — Discovered commands

Inspection (`find scripts`, `grep kafka|http3|event-layer|transport-watchdog`):

| Category | Script / service |
|----------|------------------|
| Event layer | `scripts/run-event-layer-verification.sh` |
| Proto ↔ topics | `scripts/verify-proto-events-topics.sh` |
| Kafka partitions | `scripts/verify-kafka-event-topic-partitions.sh` |
| Kafka producer/consumer | `scripts/audit-rp-kafka-producer-consumer-contract.sh` |
| Event outbox | `scripts/audit-rp-event-outbox-contract.sh` |
| Edge / HTTP3 | `scripts/audit-rp-metallb-quic-edge.sh`, `scripts/compare-http2-http3.sh`, `scripts/check-quic-invariants.sh` |
| Edge contract | `scripts/audit-rp-edge-contract.sh` |
| API gateway | `scripts/audit-rp-api-gateway-routes.sh`, `scripts/ci/smoke-api-gateway.sh` |
| Playwright strict edge | `scripts/webapp-playwright-strict-edge.sh` |
| AI contracts | `scripts/audit-rp-ai-rag-contract.sh`, `scripts/rp-ai-rag-quality-smoke.sh`, `scripts/audit-rp-ai-runtime-contract.sh`, `scripts/audit-rp-ai-endpoints-contract.sh` |
| Provider / pgvector | `scripts/rp-ai-provider-readiness.sh`, `scripts/rp-ai-pgvector-readiness.sh` |
| Transport watchdog | Sidecar on `deploy/api-gateway` (`services/transport-watchdog`) — no standalone E2E script |
| Event-layer service | `services/event-layer-verification` (Vitest) |

---

## Protocol matrix

| Target | Command / source | Protocol | HTTP | Time ms | Result |
|--------|------------------|----------|------|--------:|--------|
| `/` h2 | `curl --http2 --cacert certs/dev-chain.pem` | **2** | 200 | 1,248 | PASS |
| `/insights` h2 | `curl --http2 --cacert certs/dev-chain.pem` | **2** | 200 | 261 | PASS |
| `/` h3 | `curl --http3-only --cacert certs/dev-chain.pem` | **3** | 200 | 410 | PASS |
| `/insights` h3 | `curl --http3-only --cacert certs/dev-chain.pem` | **3** | 200 | 57 | PASS |
| `/insights` document (browser) | Playwright `performance.getEntriesByType('resource')` | **h2** | 200 | 244* | PASS |
| `/api/ai/rag/query` (browser) | Playwright resource timing | **h2** | 200 | 11,725* | PASS |

\*Browser resource `duration_ms` for matched entry; RAG UI round-trip 3,766 ms.

**Response headers (`/` h2):** `server: Caddy`, `alt-svc: h3=":443"; ma=86400`, `strict-transport-security`, `x-powered-by: Next.js`.

---

## UI prompt results — record intelligence (post T20.13T)

Run: `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"`  
Timestamp: `20260627-034347`

| Scenario | HTTP | UI ms | API ms | Score | Answer chars | Source types | Leakage | Result |
|----------|------|------:|-------:|------:|-------------:|--------------|---------|--------|
| Listing advice | 200 | 4,348 | 4,081 | 4.0 | 455 | listing_revision, listing, record | PASS | PASS |
| Negotiation price advice | 200 | 8,845 | 6,615 | 4.0 | 335 | listing | PASS | PASS |
| Buyer psychology | 200 | 3,332 | 3,178 | 3.0 | 524 | listing, obo_offer_summary | PASS | PASS |
| **Auction psychology** | **200** | 3,247 | 3,112 | **4.0** | **460** | **auction_bid_summary** | PASS | **PASS (crash fixed)** |
| Pricing strategy | 200 | 4,849 | 1,891 | 3.5 | 496 | obo_offer_summary | PASS | PASS |
| Collector listing quality | 200 | 3,780 | 1,564 | 2.0 | 328 | listing, listing_revision | PASS | PARTIAL |
| Daily seller action plan | 200 | 2,179 | 2,111 | 2.0 | 215 | listing | PASS | PARTIAL |

**Aggregate:** 7/7 UI hard-pass · avg domain **3.21/5** (was 2.93) · leakage PASS · keyword/rule-engine · p50 UI 3,780 ms / p95 8,845 ms.

### Auction scenario — full output after fix

**Prompt:**

```text
What auction or bidding signals should I watch right now? Look for bid activity, urgency, risk, and whether I should adjust listing strategy. If there is not enough auction evidence, say so.
```

**Rendered UI answer:**

```text
Offer and bidding activity from your retrieved records: 1. Offers: 0 pending, 0 countered across 0 listing reference(s) 2. Amounts seen: $10–$51 USD (from grounded excerpts only) 3. Auction/bid signals: likely_underpriced (low); ending_soon (high); stale_listing (low) Recommended next step: Prioritize countered offers and listings with expiring pending amounts. Grounding: based on 8 excerpt(s) from auction_bid_summary. Private message bodies were not used.
```

**Evidence:**

- `auction_bid_summary:303de8fa…` — Matrix Auction, bid count 2, ended, 1700 cents
- `auction_bid_summary:80616f6d…` — Auction Proxy, bid count 3, 5100 cents, active

**Telemetry:** HTTP 200 · retrieval_mode=keyword · model_used=rule-engine · template=offer_bidding_activity · UI 3,247 ms · API 3,112 ms · refs=8 · leakage PASS

**Crash fixed:** Yes — was HTTP 500 (`AttributeError` on string metadata); T20.13T `_coerce_chunk_metadata()` resolves.

---

## Generic UI RAG (T20.13P rerun)

**Result:** PASS — 7/7 · keyword/rule-engine · leakage PASS · avg 432 chars · p50 UI 3,470 ms / p95 11,247 ms.

---

## Browser protocol telemetry (Playwright)

Harness: `webapp/e2e/ai-rag-protocol-pipeline.spec.ts`  
Timestamp: `20260627-034139`

- Document `/insights` resources: **h2**
- `/api/ai/rag/query`: **h2**, HTTP 200, keyword, rule-engine, leakage PASS
- Console errors: 2× unrelated 400 (non-AI resources)
- Failed AI requests: none

---

## Event pipeline matrix

| Component | Check command | Exit | Evidence | Result |
|-----------|---------------|-----:|----------|--------|
| event-layer-verification | `SKIP_VITEST=1 ./scripts/run-event-layer-verification.sh` | 0 | Proto ↔ 15 topics OK, envelope PARTITIONS=6 | PASS |
| Kafka partition verify | `verify-kafka-event-topic-partitions.sh` (in event-layer script) | — | Skipped — no docker compose Kafka | SKIP |
| producer/consumer audit | `./scripts/audit-rp-kafka-producer-consumer-contract.sh` | 0 | TLS handshakes kafka-0:9093; consumer group notification-service-group; topics list SSL | PASS |
| event outbox | `./scripts/audit-rp-ai-event-outbox-contract.sh` | 0 | outbox_events columns OK; runtime messaging outbox count=116 | PASS |
| transport-watchdog | Sidecar logs on `deploy/api-gateway` | — | Sidecar present; logs `gateway not ready → SET rp:gw:watchdog_throttle` | PARTIAL |
| AI RAG async dependency | Code path review | — | `rag_query` → sync keyword retrieval + synthesis; no Kafka wait | N/A (sync) |

**Producer services (from audit):** listings-service, messaging-service, shopping-service (Kafka TLS env + secret mounts verified).  
**Consumer:** notification-service-group verified.

---

## Contract / readiness (U6)

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-runtime-contract.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |

Production retrieval remains **keyword**; `model_used=rule-engine`.

---

## End-to-end path proof

```text
Browser UI (/insights)
→ Edge TLS (Caddy, alt-svc h3)
→ HTTP/2 observed in browser (h2) / HTTP/3 available via curl (3)
→ Next.js webapp /api/ai/rag/query (BFF proxy)
→ api-gateway routing
→ python-ai-service POST /ai/rag/query (rag_query)
→ keyword retrieval (Postgres corpus / pgvector table, keyword path)
→ rule-engine synthesis (synthesize_rag_summary)
→ response JSON (source_refs, excerpts in details)
→ rendered DOM answer (ai-rag-summary)
→ source refs visible (ai-source-ref-item, truncated type:id)
```

**Event pipeline:** AI RAG path is **synchronous** and does **not** depend on event producer/consumer completion. Outbox/Kafka used by messaging/listings/shopping flows; RAG reads indexed corpus directly.

---

## Remaining blockers

- Vector rollout: shadow latency p95 and overlap still block default-on vector
- Phase 21: not started
- Record intelligence domain depth: collector metadata + daily action plan score 2.0; avg 3.21 < 3.5
- UI source panel shows refs only, not full excerpt bodies
- transport-watchdog sidecar reporting gateway-not-ready throttle (non-blocking for RAG)
- Kafka partition verify skipped in dev (no compose Kafka)
- Structured endpoints still recommended: listing_advice, negotiation_strategy, auction_pressure

---

## Final verdict

```text
Production UI keyword RAG: PARTIAL
Protocol/pipeline acceptance: PARTIAL
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Rationale:** Protocol stack (h2/h3 edge, browser h2 RAG, contracts, 7/7 UI renders, auction crash fixed) is sound. **PARTIAL** because record-intelligence domain scores remain shallow on collector/action-plan scenarios and transport-watchdog shows throttle warnings. Recommend structured endpoints before Phase 21; keep vector blocked.

---

## Files added (T20.13U)

| File | Role |
|------|------|
| `webapp/e2e/ai-rag-protocol-pipeline.spec.ts` | Browser protocol telemetry + RAG smoke |
| `webapp/e2e/helpers/ai-rag-protocol-pipeline.ts` | Artifact writer |
| `docs/ai-platform/T20-13U-protocol-pipeline-rag-acceptance.md` | This report |

## Related

| Ticket | Role |
|--------|------|
| T20.13T | Auction metadata coercion fix |
| T20.13R/S | Record-intelligence domain UI acceptance |
| T20.13P/Q | Generic UI RAG acceptance |
