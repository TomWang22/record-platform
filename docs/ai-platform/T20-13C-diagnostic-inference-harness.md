# T20.13C — Diagnostic inference harness

**Status:** IMPLEMENTED  
**Baseline SHA:** `bf27414` (pre-implementation)  
**Scope:** diagnostic/test harness only — no product behavior changes

## Components

| File | Role |
|------|------|
| `scripts/rp-ai-live-inference-transcript.sh` | Shell entrypoint (T20.13C) |
| `scripts/rp-ai-live-inference-transcript.py` | Orchestrates three modes + structured endpoints |
| `scripts/rp-ai-live-inference-telemetry.py` | Parser, failure classification, aggregation, `--self-test` |

## Use-case suite

**RAG keyword + shadow (7 cases):**

- `catalog_activity`
- `seller_notifications`
- `offer_bidding_activity`
- `listing_revision_changes`
- `private_negotiation_no_messages`
- `seller_attention_today`
- `marketplace_activity_summary`

**Structured endpoints (5):**

- `seller_sales_summary`
- `buyer_collection_summary`
- `pricing_recommendation`
- `record_valuation`
- `auction_risk`

## Three modes

1. **Production keyword** — `shadow_vector=0`
2. **Shadow diagnostic, flags off** — `shadow_vector=1&shadow_debug=1`
3. **Shadow diagnostic, flags on** — temporarily `AI_RAG_SHADOW_ENTITY_HINTS=1`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1`, then reset to `0`

## Outputs (local only, not committed)

```text
bench_logs/ai-platform/live-inference/<timestamp>.md
bench_logs/ai-platform/live-inference/<timestamp>.summary.json
bench_logs/ai-platform/live-inference/raw-<timestamp>/*.json
```

## Telemetry parser (C1)

- `normalize_path()` — accepts `str` or `Path` (fixes `AttributeError: 'str' object has no attribute 'name'`)
- `safe_get()` — dotted paths, dict/list tolerant, returns `not_exposed` on miss
- `classify_failure()` — `request_error`, `embed_timeout_before_fetch`, `candidate_fetch_returned_zero`, `malformed_response`, `not_zero_result`, `unknown`
- Malformed cases become telemetry rows, not tracebacks

## Self-test

```bash
python3 scripts/rp-ai-live-inference-telemetry.py --self-test
```

## Validation

```bash
bash -n scripts/rp-ai-live-inference-transcript.sh
python3 scripts/rp-ai-live-inference-telemetry.py --self-test
bash scripts/rp-ai-live-inference-transcript.sh
```

## Verdict

```text
Vector rollout: NOT APPROVED
Phase 21: not started
Production retrieval remains keyword
```

Next: **T20.13D** telemetry report from harness run.
