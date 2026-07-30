# P21.1A — Seller intelligence UI surfaces

**Status:** Implemented  
**Baseline SHA:** `78c3b1a` (P21.0 charter)  
**Phase:** 21 — non-vector product track

---

## Summary

Added a **Seller intelligence** section on `/insights` with four structured panels wired to existing python-ai endpoints. Existing RAG query card and all prior dashboard panels preserved.

---

## UI components

| File | Role |
| ---- | ---- |
| `webapp/components/ai/seller-intelligence-panels.tsx` | Four panel cards, loading/error/degraded, caveats, source refs |
| `webapp/components/ai/ai-insights-dashboard.tsx` | Mounts `SellerIntelligencePanels` after RAG card |
| `webapp/lib/ai-insights-client.ts` | `fetchSellerListingAdvice`, `fetchSellerNegotiationStrategy`, `fetchSellerAuctionPressure`, `fetchSellerCollectorMetadataGaps` |
| `webapp/e2e/seller-intelligence-ui.spec.ts` | Playwright acceptance (fresh contract login) |

---

## Endpoint mapping

| Panel | Endpoint | contract_id |
| ----- | -------- | ------------- |
| Listing Advice | `POST /api/ai/seller/listing-advice` | `listing_advice` |
| Negotiation Strategy | `POST /api/ai/seller/negotiation-strategy` | `negotiation_strategy` |
| Auction Pressure | `POST /api/ai/seller/auction-pressure` | `auction_pressure` |
| Collector Metadata Gaps | `POST /api/ai/seller/collector-metadata-gaps` | `collector_metadata_gaps` |

---

## Test IDs

- `seller-intelligence-panel`
- `seller-listing-advice-card` / `seller-listing-advice-summary` / `seller-listing-advice-ready`
- `seller-negotiation-strategy-card` / `seller-negotiation-strategy-summary` / `seller-negotiation-strategy-ready`
- `seller-auction-pressure-card` / `seller-auction-pressure-summary` / `seller-auction-pressure-ready`
- `seller-collector-metadata-card` / `seller-collector-metadata-summary` / `seller-collector-metadata-ready`
- `seller-intelligence-source-ref`
- `seller-intelligence-error`

---

## Panel behavior

- Shows `source_status`, `model_used`, confidence, source count via `AiInsightMeta`
- Degraded responses render caveats (not hard failures)
- Negotiation panel shows privacy note: private message bodies were not used
- Missing metadata / evidence gaps surfaced from `details` and summary text

---

## Validation

```bash
pytest services/python-ai-service/tests/ -q          # 203 passed
bash scripts/audit-rp-ai-endpoints-contract.sh      # PASS
bash scripts/rp-ai-rag-quality-smoke.sh             # PASS
./scripts/webapp-playwright-strict-edge.sh \
  e2e/seller-intelligence-ui.spec.ts \
  --grep "Seller intelligence UI"                   # 1 passed
bash scripts/rp-rp-decontaminate-scan.sh           # PASS
```

---

## Boundaries (unchanged)

- Keyword retrieval + rule-engine only
- No vector default, no T20.14/T20.15
- No message body exposure
