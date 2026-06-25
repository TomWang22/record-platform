# T20.12H — Live inference transcript harness

**Status:** committed harness (read-only)  
**Purpose:** Repeatable post-tranche evidence loop — real prompts, real answers, shadow diagnostics, leakage checks.

## Script

```bash
bash scripts/rp-ai-live-inference-transcript.sh
```

Options:

- `--help` — usage
- `--skip-flagged` — skip temporary overlap-flag diagnostic mode
- `--skip-endpoints` — skip structured insight endpoints

## Output (local only — do not commit)

| Path | Content |
|------|---------|
| `bench_logs/ai-platform/live-inference/<timestamp>.md` | Human-readable transcript |
| `bench_logs/ai-platform/live-inference/raw-<timestamp>/` | Per-case JSON |

## Modes

1. **Production keyword** — no shadow; expect `retrieval_mode=keyword`, `model_used=rule-engine`
2. **Shadow diagnostic (flags off)** — `AI_RAG_SHADOW_VECTOR=0`, entity/neighbor `0/0`; capture shadow source types, overlap, timings
3. **Flagged diagnostic** — temporarily `AI_RAG_SHADOW_ENTITY_HINTS=1`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1`; reset to `0/0` after run

## RAG cases (7)

1. Catalog activity  
2. Seller notifications  
3. Offer/bidding activity  
4. Listing revisions  
5. Private negotiation context (no message bodies)  
6. Seller attention today  
7. Marketplace activity relevant to me  

## Structured endpoints (6)

- `seller_sales_summary`
- `buyer_collection_summary`
- `pricing_recommendation`
- `record_valuation`
- `auction_risk`
- `rag_query_smoke`

## Safety

- Scans for forbidden/proxy terms and `message` source types
- Fails on message-body leakage patterns
- Always resets overlap flags to `0/0`

## Auth / network

Uses existing contract conventions from:

- `scripts/audit-rp-ai-rag-contract.sh`
- `scripts/rp-ai-rag-quality-smoke.sh`
- `scripts/audit-rp-ai-endpoints-contract.sh`

Env: `RP_COMB_EMAIL`, `RP_COMB_PASSWORD`, `K8S_NS`, optional `TARGET_IP`.

## Console summary

After run, prints keyword/endpoint counts, production `model_used`, shadow overlap (default vs flagged), leakage, flags reset, and rollout verdict (`Vector rollout: NOT APPROVED`).

## When to run

After every bounded embedding tranche actual write, as part of T20.12I readiness eval (alongside contract/smoke/shadow diagnostics).
