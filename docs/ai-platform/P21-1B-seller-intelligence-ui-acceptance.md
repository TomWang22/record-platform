# P21.1B — Seller intelligence UI acceptance

**Generated:** 2026-06-27  
**Baseline SHA:** (post P21.1A commit)  
**Charter:** `docs/ai-platform/P21-0-non-vector-seller-intelligence-charter.md`

---

## Run metadata

| Field | Value |
| ----- | ----- |
| Route | `/insights` |
| Command | `./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"` |
| Browser | chromium |
| Login | `e2e-contract@record-platform.local` (fresh contract login) |
| Base URL | `https://record-platform.test` |
| Total page time | ~12,122 ms (4 panels + dashboard load) |

Artifacts (local, not committed): `webapp/test-results/` (Playwright run output).

---

## Panel results

| Panel | Endpoint | HTTP | Rendered | Summary chars | Refs | Latency ms | Leakage | Result |
| ----- | -------- | ---- | -------- | ------------: | ---: | ---------: | ------- | ------ |
| Listing Advice | `/api/ai/seller/listing-advice` | 200 | yes | 577 | ≥1 | ~3,000* | PASS | PASS |
| Negotiation Strategy | `/api/ai/seller/negotiation-strategy` | 200 | yes | 1,490 | ≥1 | ~3,000* | PASS | PASS |
| Auction Pressure | `/api/ai/seller/auction-pressure` | 200 | yes | 700 | ≥1 | ~3,000* | PASS | PASS |
| Collector Metadata Gaps | `/api/ai/seller/collector-metadata-gaps` | 200 | yes | 372 | ≥1 | ~3,000* | PASS | PASS |

\*Per-panel network timing not exported by Playwright resource timing for parallel fetches; total section load ~12s including RAG card and other dashboard panels.

---

## Rendered summary excerpts

**Listing Advice:** Catalog health check (grounded excerpts only) — weak listings, buyer interest gap, revision signals, recommended listing edits…

**Negotiation Strategy:** Offer summaries only — pending/countered lines with review actions; amount ranges from grounded excerpts…

**Auction Pressure:** Auction/bid signals from bid summaries; urgency caveats when evidence sparse…

**Collector Metadata Gaps:** Collector metadata check — Title/Price/Condition/Pressing present or missing per excerpts…

---

## Source refs

- All four panels rendered `seller-intelligence-source-ref` items (aggregate count > 0 in panel section)
- `model_used`: `rule-engine` on live responses
- `source_status`: `live` for contract user corpus

---

## RAG card regression

| Check | Result |
| ----- | ------ |
| `ai-insights-dashboard-ready` | visible |
| `ai-rag-summary` | visible, non-empty |
| `ai-insight-rag-ready` | visible |
| RAG leakage | PASS |

Existing free-form RAG card unchanged and functional after fresh login.

---

## Contracts

| Script | Result |
| ------ | ------ |
| pytest python-ai | 203 passed |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS |

---

## Remaining gaps

1. Full sanitized source excerpts not yet in UI (P21.2)
2. Per-panel latency telemetry not surfaced in UI (P21.5)
3. Stale cached auth token caused initial 401 in test — fixed with `signInFreshContract` in spec

---

## Final verdict

```text
Phase 21 non-vector product track: STARTED
Seller intelligence UI surfaces: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
