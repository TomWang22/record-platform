# Phase 21 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-06-28 (P21.8 release closeout)  
**Current main SHA:** `13bc0ad` (verify at commit time)  
**Phase 21 status:** **READY FOR RELEASE** — non-vector seller intelligence product track **CLOSED**  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

Use this document as the **source of truth** for Phase 21 state. For Phase 20 vector/shadow history, see `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`.

---

## Locked takeaway

```text
Phase 21 non-vector seller intelligence: READY FOR RELEASE (closeout @ 13bc0ad)

Production path:
- retrieval: keyword
- synthesis: rule-engine (rag_synthesis.py templates)
- model_used: rule-engine
- vector default: OFF
- AI_RAG_SHADOW_VECTOR: 0 (must remain off unless explicitly approved)

Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```

### Copilot-safe instruction

```md
Use @docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md as the source of truth for Phase 21.

Do NOT enable vector retrieval as production default.
Do NOT start T20.14/T20.15 or embedding tranches without explicit approval.
Do NOT enable hybrid rollout or default-on overlap flags.
Do NOT use generative Ollama as production RAG default.
Do NOT expose message bodies in UI or API responses.

Phase 21 product track is CLOSED at P21.8. No new feature work unless a new charter is approved.
Tag rp-ai-phase-21-non-vector-seller-intelligence-20260628 is PREPARED, NOT CREATED — P21.9 only with explicit approval.
```

---

## Production path (unchanged)

| Setting | Value |
| ------- | ----- |
| Retrieval | `keyword` |
| Synthesis | `rule-engine` |
| Vector default | off |
| `AI_RAG_SHADOW_VECTOR` | 0 |
| Generative Ollama for RAG | off |
| Overlap refinement flags | default off |

---

## Structured endpoints (python-ai-service)

Gateway prefix: `/api/ai/` (webapp proxies to python-ai-service `/ai/`).

### Seller intelligence (Phase 21 product)

| Endpoint | Contract ID | Purpose |
| -------- | ----------- | ------- |
| `POST /seller/listing-advice` | `listing_advice` | Catalog health, weak listings, revisions |
| `POST /seller/negotiation-strategy` | `negotiation_strategy` | OBO offer summaries only |
| `POST /seller/auction-pressure` | `auction_pressure` | Bid-summary urgency signals |
| `POST /seller/collector-metadata-gaps` | `collector_metadata_gaps` | 22-field metadata + completeness |

### Session memory (API prototype — P21.3)

| Endpoint | Contract ID |
| -------- | ----------- |
| `POST /session/start` | `session_start` |
| `POST /session/query` | `session_query` |
| `GET /session/{session_id}` | `session_get` |
| `POST /session/reset` | `session_reset` |

In-memory only; TTL; no DB persistence; not multi-pod safe.

### Other structured endpoints (pre–Phase 21, still live)

| Endpoint | Contract ID |
| -------- | ----------- |
| `POST /rag/query` | `rag_query` |
| `POST /records/valuation` | `record_valuation` |
| `POST /listings/pricing-advice` | `pricing_recommendation` |
| `POST /auctions/risk` | `auction_risk` |
| `POST /seller/summary` | `seller_sales_summary` |
| `POST /buyer/collection-summary` | `buyer_collection_summary` |

---

## UI surfaces (webapp)

| Surface | Route / test ID | Notes |
| ------- | ----------------- | ----- |
| AI Insights dashboard | `/insights` | `ai-insights-dashboard` |
| Seller intelligence section | above RAG card | `seller-intelligence-panel` |
| Listing advice panel | — | `seller-listing-advice-card` |
| Negotiation strategy panel | — | `seller-negotiation-strategy-card` |
| Auction pressure panel | — | `seller-auction-pressure-card` |
| Collector metadata panel | field map UI | `seller-collector-metadata-card` |
| RAG query card | deferred prefetch | `ai-insight-rag`, `ai-rag-summary` |
| Source evidence | expand/collapse | `ai-source-evidence-item`, `ai-source-evidence-toggle` |
| Seller dashboard ready | sr-only signal | `seller-dashboard-ready` |

Session memory has **no** dedicated `/insights` chat UI in Phase 21.

Key files:

- `webapp/components/ai/seller-intelligence-panels.tsx`
- `webapp/components/ai/ai-insights-dashboard.tsx`
- `webapp/components/ai/ai-source-evidence-list.tsx`
- `webapp/components/ai/collector-metadata-field-map.tsx`
- `webapp/lib/ai-insights-client.ts`

---

## Validation metrics (P21.7B final)

| Metric | Value | Gate |
| ------ | ----: | ---- |
| Seller panels | 4/4 | PASS |
| seller_dashboard_ready_ms | 12,307 | ≤15,000 PASS |
| ui_latency_p95_ms | 11,247 | ≤15,000 PASS |
| endpoint_latency_p95_ms | 11,015 | ≤12,000 PASS |
| record_intelligence_avg_score | 3.86 | ≥3.5 PASS |
| longform_avg_score | 3.67 | ≥3.5 PASS |
| final_turn_score | 4.0 | ≥4.0 PASS |
| leakage | PASS | PASS |
| telemetry WARNs | 0 | PASS |
| pytest | 222 passed | PASS |
| forbidden_hit_count | 0 | PASS |
| source_refs_present_rate | 1.00 | PASS |
| source_excerpt_present_rate | 1.00 | PASS |

Re-validate:

```bash
./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"
node scripts/ai-quality-telemetry-report.mjs
cd services/python-ai-service && source .venv/bin/activate && PYTHONPATH=. python -m pytest tests/ -q
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Telemetry reporter: `scripts/ai-quality-telemetry-report.mjs`  
Design: `docs/ai-platform/P21-5A-ai-quality-telemetry-design.md`

---

## Hard stops (all future work)

| Rule | Status |
| ---- | ------ |
| No vector default rollout | **BLOCKED** |
| No hybrid rollout | **BLOCKED** |
| No T20.14 / T20.15 | **BLOCKED** |
| No embedding tranches without separate approval | **BLOCKED** |
| No default-on overlap flags | **BLOCKED** |
| No generative Ollama as production RAG default | **BLOCKED** |
| No message body exposure | **REQUIRED** |
| Do not commit `bench_logs/`, screenshots, traces | **REQUIRED** |

---

## Known limitations

- Session memory in-process only
- Four seller panels = four independent keyword retrievals
- Collector field map not on free-form RAG card
- Sparse corpus → excerpt unavailable fallback
- Vector latency/overlap unresolved (Phase 20 blockers carry forward)

---

## Phase 21 ticket map (all closed)

| Ticket | Doc |
| ------ | --- |
| P21.0 | `P21-0-non-vector-seller-intelligence-charter.md` |
| P21.1 | `P21-1A-seller-intelligence-ui-surfaces.md`, `P21-1B-seller-intelligence-ui-acceptance.md` |
| P21.2 | `P21-2A-source-evidence-ux.md`, `P21-2B-source-evidence-ux-acceptance.md` |
| P21.3 | `P21-3B-session-memory-prototype-acceptance.md`, `P21-3C-session-endpoint-hardening.md` |
| P21.4 | `P21-4B-collector-metadata-acceptance.md`, `P21-4C-collector-metadata-fieldmap-ui.md` |
| P21.5 | `P21-5A-ai-quality-telemetry-design.md`, `P21-5B-ai-quality-telemetry-acceptance.md` |
| P21.6 | `P21-6A-non-vector-latency-triage.md`, `P21-6B-non-vector-latency-acceptance.md` |
| P21.7 | `P21-7A-non-vector-seller-intelligence-rc.md`, `P21-7B-non-vector-seller-intelligence-final-validation.md` |
| P21.8 | `P21-8-release-closeout.md` (this closeout) |

Release note: `docs/release/rp-ai-phase-21-non-vector-seller-intelligence.md`

---

## Next optional tracks (not started — require explicit approval)

| Track | Scope |
| ----- | ----- |
| **P21.9** | Git tag creation — `rp-ai-phase-21-non-vector-seller-intelligence-20260628` — **explicit approval only** |
| **P21.10** | Batch seller endpoint design — reduce four parallel retrievals |
| **P21.11** | Persistent session memory design — Redis/DB, multi-pod |
| **P21.12** | Observation-deck integration — feed telemetry JSON into `/observation-deck` |

Do not start P21.9–P21.12 without user approval. Vector rollout remains a **separate** decision track (T20.14/T20.15).

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: READY FOR RELEASE
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
