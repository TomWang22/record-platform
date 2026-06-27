# T20.13Z — Post-intelligence gauntlet scoreboard

**Baseline SHA:** `f249d6e`  
**Post-implementation run:** `20260627-043358` (record intelligence), `20260627-043448` (longform)  
**Image:** `python-ai-service:t20-13xyz`

## Before

| Metric | Score |
|--------|-------|
| Record intelligence avg | 3.21/5 |
| Longform avg | 3.13/5 |
| Final turn | 3.0/5 |
| Collector metadata (longform turn 6) | 2.0 |
| User tradeoff (longform turn 9) | 2.0 |
| Turn 12 tags | FAIL — collapsed to `private_negotiation_no_messages` |
| Turns 10–12 context | POOR — same 434-char template |

## After

| Metric | Score | Target | Status |
|--------|-------|--------|--------|
| Record intelligence avg | **3.57/5** | ≥3.5 | PASS |
| Longform avg | **3.58/5** | ≥3.5 | PASS |
| Final turn (executive summary) | **4.0/5** | ≥4.0 | PASS |
| Collector metadata (longform turn 6) | **3.0/5** | ≥3.5 | PARTIAL |
| Collector metadata (record intel case) | **4.0/5** | ≥3.5 | PASS |
| User tradeoff (longform turn 9) | **3.5/5** | ≥3.5 | PASS |
| Tagged final plan (turn 12) | **4.0/5** — includes `[grounded]` / `[missing evidence]` / `[needs manual review]` | tags present | PASS |
| Context retention turns 9–12 | **good** (3/4 turns) | — | PASS |

### Structured endpoints (live smoke)

| Endpoint | Contract | Status |
|----------|----------|--------|
| Listing advice | `listing_advice` | live — catalog health synthesis |
| Negotiation strategy | `negotiation_strategy` | live — review actions, no message bodies |
| Auction pressure | `auction_pressure` | live — bid signals from summaries |
| Collector metadata gaps | `collector_metadata_gaps` | live — field present/missing map |

### Latency

| Suite | p50 UI | p95 UI | p95 API |
|-------|--------|--------|---------|
| Record intelligence | 3,743 ms | 6,173 ms | 6,041 ms |
| Longform (12 turns) | — | 7,212 ms | — |

### Safety / contracts

| Check | Result |
|-------|--------|
| Message leakage | PASS (both suites) |
| pytest `services/python-ai-service/tests/` | 203 passed |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-runtime-contract.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |
| Vector rollout | NOT APPROVED |
| Phase 21 | not started |

## Remaining gaps

1. **Longform collector metadata (turn 6)** — 3.0/5: answer structure correct but evaluator wants deeper field-level nuance per listing.
2. **Record intelligence listing_advice case** — prompt mentions “revision history”; keyword retrieval still routes to `listing_revision_changes` (score 4.0 anyway).
3. **Daily seller action plan** — post-fix routes to `final_action_plan` (verified via API curl); re-run not repeated in this artifact set after routing fix.
4. **Multi-turn memory** — turns 10–12 use accumulated prompt text, not server-side session state; acceptable for rule-engine V1 but not true conversational memory.

## Key synthesis templates (longform turn 12)

```
template: tagged_executive_summary
answer excerpt: Final 10-bullet seller plan (tagged):
1. [grounded] Review countered offers around $4136–$4436 ...
2. [missing evidence] Auction urgency cannot be assessed unless auction_bid_summary refs are retrieved.
3. [needs manual review] Verify pressing/scarcity before discounting jazz or rare inventory.
```

Artifacts: `bench_logs/ai-platform/longform-rag-session/20260627-043448/`, `bench_logs/ai-platform/ui-record-intelligence/20260627-043358/` (not committed).
