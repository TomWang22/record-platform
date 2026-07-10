# T20.13T — Auction metadata coercion fix

**Status:** Implemented  
**Generated:** 2026-06-27  
**Baseline SHA:** `93c5488`

---

## Problem

T20.13S record-intelligence UI acceptance: **auction psychology** scenario returned HTTP 500.

**Root cause:** `_synthesize_offer_bidding` and `_rank_seller_actions` passed chunk `metadata` directly to `auction_risk_signals()`. When `auction_bid_summary` chunks carry metadata as a **JSON string** (from Postgres/pgvector row serialization), `meta.get("bid_count")` raised `AttributeError: 'str' object has no attribute 'get'`.

---

## Fix

Added `_coerce_chunk_metadata()` in `rag_synthesis.py`:

| Input | Output |
|-------|--------|
| `dict` | use as-is |
| JSON string | `json.loads` → dict if object |
| invalid string / null / list | `{}` |

Applied at both auction call sites before `auction_risk_signals()`.

**No retrieval, vector, contract, or generative changes.**

---

## Tests

`services/python-ai-service/tests/test_rag_synthesis.py` — `TestAuctionMetadataCoercion`:

- metadata as dict
- metadata as JSON string
- invalid string
- missing metadata
- auction psychology prompt synthesizes without crash
- leakage still blocked (no message_body in summary)

---

## Validation

```bash
pytest services/python-ai-service/tests/ -q
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

---

## Scope guardrails

- No vector rollout
- No Phase 21
- No DB writes
- No embedding tranches
