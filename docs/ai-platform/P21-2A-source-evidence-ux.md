# P21.2A — Source evidence UX

**Status:** Implemented  
**Baseline SHA:** `1499bda`  
**Phase:** 21 — non-vector product track

---

## Summary

Replaced truncated `source_type:id` lists with expandable **source evidence** rows on `/insights` for the RAG card and all four seller intelligence panels.

---

## Components

| File | Role |
| ---- | ---- |
| `webapp/lib/ai-source-evidence.ts` | Sanitize excerpts, forbidden-field guard, preview formatting |
| `webapp/components/ai/ai-source-evidence-list.tsx` | Expand/collapse evidence list with test IDs |
| `webapp/components/ai/seller-intelligence-panels.tsx` | Wired seller panels to evidence list |
| `webapp/components/ai/ai-insights-dashboard.tsx` | RAG card uses evidence list |
| `services/python-ai-service/app/ai/insights.py` | `details.excerpts` on seller structured endpoints |

---

## UI behavior

**Collapsed row:** `listing:66a83502… · 2026-06-24 · Seller listing: E2E Lean Listing Status: active…`

**Expanded row:** Full sanitized excerpt (max 300 chars from API) or `Source excerpt unavailable`

**Privacy label:** “Private message bodies are not shown.”

---

## Safety (client)

Never render text matching:

- `message_body`
- `thread_text`
- `private obo message`
- `proxy_bids`
- `max_bid_cents`

Objects/JSON metadata dumps are rejected by `sanitizeEvidenceExcerpt`.

---

## Test IDs

- `ai-source-evidence-list`
- `ai-source-evidence-item`
- `ai-source-evidence-toggle`
- `ai-source-evidence-excerpt`
- `ai-source-evidence-unavailable`
- `seller-intelligence-source-excerpt`

---

## Validation

```bash
./scripts/webapp-playwright-strict-edge.sh \
  e2e/seller-intelligence-ui.spec.ts \
  --grep "Seller intelligence UI"

bash scripts/rp-och-decontaminate-scan.sh
```

---

## Boundaries

- Keyword retrieval unchanged
- No vector rollout
- No message body exposure
