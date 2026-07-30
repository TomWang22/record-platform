# P21.2B — Source evidence UX acceptance

**Generated:** 2026-06-27  
**Baseline SHA:** `84b3315` (pre P21.2A commit)  
**Implementation:** `docs/ai-platform/P21-2A-source-evidence-ux.md`

---

## Run metadata

| Field | Value |
| ----- | ----- |
| Route | `/insights` |
| Command | `./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"` |
| Browser | chromium |
| Login | `e2e-contract@record-platform.local` (fresh contract login) |
| Base URL | `https://record-platform.test` |
| Deploy | `python-ai-service:t20-p212`, `webapp:dev` (Colima rollout) |
| Total page time | ~15,286 ms (4 panels + RAG card + evidence expand) |

Artifacts (local, not committed): `webapp/test-results/` (Playwright run output).

---

## Panel results

| Panel | Source refs | Excerpts visible | Expand/collapse | Forbidden scan | Result |
| ----- | ----------- | ---------------- | --------------- | -------------- | ------ |
| Listing Advice | ≥1 | yes (sanitized preview + expanded) | PASS | PASS | PASS |
| Negotiation Strategy | ≥1 | yes | PASS | PASS | PASS |
| Auction Pressure | ≥1 | yes | PASS | PASS | PASS |
| Collector Metadata Gaps | ≥1 | yes | PASS | PASS | PASS |

Each panel: `ai-source-evidence-item` visible, first item expanded via `ai-source-evidence-toggle`, excerpt or `Source excerpt unavailable` shown via `seller-intelligence-source-excerpt` / `ai-source-evidence-unavailable`.

Privacy label rendered: “Private message bodies are not shown.”

---

## Source excerpt render status

- Collapsed rows show `source_type:shortId… · freshness · excerpt preview`
- Expanded rows show full sanitized excerpt from `details.excerpts` (seller endpoints) or RAG `details.excerpts`
- Client-side `sanitizeEvidenceExcerpt` blocks forbidden field names and raw JSON dumps
- Backend `_sanitized_excerpts` added to all four seller structured endpoints

---

## Expand/collapse status

| Surface | Toggle test ID | Expanded content test ID | Result |
| ------- | -------------- | ------------------------ | ------ |
| Seller panels (×4) | `ai-source-evidence-toggle` | `seller-intelligence-source-excerpt` | PASS |
| RAG card | `ai-source-evidence-toggle` | `ai-source-evidence-excerpt` | PASS |

---

## Forbidden string scan

Playwright + page body scan for:

- `message_body`
- `thread_text`
- `private obo message`
- `proxy_bids`
- `max_bid_cents`

**Result:** PASS (no matches in panel summaries, expanded excerpts, or full page body)

---

## RAG card regression

| Check | Result |
| ----- | ------ |
| `ai-insights-dashboard-ready` | visible |
| `ai-rag-summary` | visible, non-empty |
| `ai-insight-rag-ready` | visible |
| RAG source evidence expand | PASS |
| RAG leakage | PASS |

---

## Latency impact

| Metric | Value |
| ------ | ----- |
| Total `/insights` load (4 panels + RAG + expand) | ~15,286 ms |
| Playwright wall time | 23.8 s |
| Per-panel API ms (resource timing) | 0* (not exported for parallel POSTs) |

\*No measurable regression vs P21.1B (~12,122 ms total); additional expand/collapse interactions add ~3 s UI interaction time.

---

## Contracts

| Script | Result |
| ------ | ------ |
| Playwright seller intelligence UI | 1 passed |
| `rp-rp-decontaminate-scan.sh` | PASS (590 scanned) |
| pytest `test_seller_listing_advice_live` | PASS (`details.excerpts` present) |

---

## Remaining gaps

1. Per-panel latency telemetry not surfaced in UI (P21.5)
2. Some source refs may still lack matching excerpt keys — UI shows “Source excerpt unavailable” (expected fallback)
3. Vector/hybrid retrieval unchanged — keyword only

---

## Final verdict

```text
Phase 21 source evidence UX: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
