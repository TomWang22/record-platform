# Phase 21 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-06-29 (T20.15N–Q complete; 10% eval PASS; 25% design only)  
**Current main SHA:** verify with `git rev-parse --short HEAD`  
**Release tag:** `rp-ai-phase-21-non-vector-seller-intelligence-20260628` @ `d0e4c58`  
**Final validation SHA (P21.7B):** `13bc0ad`  
**Phase 21 status:** **RELEASE TAGGED** — non-vector seller intelligence product track **CLOSED**  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

Use this document as the **source of truth** for Phase 21 state. For Phase 20 vector/shadow history, see `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`.

---

## Locked takeaway

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED @ d0e4c58

Production path:
- retrieval: keyword (default for all non-allowlisted users)
- synthesis: rule-engine (rag_synthesis.py templates)
- model_used: rule-engine
- vector default: OFF
- AI_RAG_SHADOW_VECTOR: 0 (must remain off unless explicitly approved)

T20.15A–Q complete.
Hybrid allowlist canary: KEEP for evidence collection only.
AI_RAG_HYBRID_CANARY_PERCENT=0 (restored after O eval).
1%, 5%, and 10% percentage cohort: PROVEN (G/K/O PASS).
10% eval: PASS; percent restored to 0.
25% design: COMPLETE (T20.15Q) — no implementation.
Production default remains keyword.
Vector production default: NOT APPROVED.
T20.15R implementation: NOT STARTED — explicit approval required.
```

### T20.15 hybrid canary (implemented)

| Item | Value |
| ---- | ----- |
| Image | `python-ai-service:t20-p215f` |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| API fallback | 1/9 on `final_tagged_plan` |
| Pure overlap | 8/16 |
| Anchored overlap | 16/16 |
| Avg quality (T20.15C API) | 3.78 |
| Hybrid p95 (T20.15O @ PERCENT=10) | 112.9 / 223.8 ms (transcript) |

### T20.14H hybrid gate (2026-06-29)

| Lane | Result |
| ---- | ------ |
| A — Pure vector overlap | **8/16 FAIL** (stable across 5 H1 runs) |
| B — Hybrid anchored overlap | **16/16 PASS** |
| C — Keyword production | **PASS** (default) |

Deploy: `python-ai-service:t20-p215b2` @ `cd12a85`.

### Copilot-safe instruction

```md
Use @docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md as the source of truth for Phase 21.

Do NOT enable vector retrieval as production default.
Do NOT set AI_RAG_HYBRID_CANARY_PERCENT above 0 without explicit owner approval for a future eval window.
Do NOT start T20.15R 25% implementation without explicit approval after Q.
Do NOT start T20.15S 25% eval without approval after R.
Do NOT enable vector production default.
Do NOT use generative Ollama as production RAG default.
Do NOT expose message bodies in UI or API responses.

Phase 21 product track is CLOSED and tagged. P21.10+ product follow-ups require explicit approval (keyword/rule-engine only).
T20.15A–Q complete: allowlist KEEP; percent=0; O PASS; P recommends Q done; R blocked.
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

## Validation metrics (P21.7B final @ `13bc0ad`)

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
| No hybrid rollout (production) | **BLOCKED** |
| T20.15 execution | **BLOCKED** (allowlist canary active; percent gate deployed at 0) |
| T20.15G 1% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15H decision | **COMPLETE** — Option B active; Option C recommended |
| T20.15J 5% gate verify | **COMPLETE** (verification-only) |
| T20.15K 5% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15L 5% decision | **COMPLETE** — Option B active; Option C → M |
| T20.15M 10% design | **COMPLETE** (design only) |
| T20.15N 10% gate verify | **COMPLETE** (verification-only) |
| T20.15O 10% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15P 10% decision | **COMPLETE** — Option B active; Option C → Q |
| T20.15Q 25% design | **COMPLETE** (design only) |
| T20.15R implementation | **NOT STARTED** |
| Hybrid allowlist canary | **KEEP** (`t20-p215f`, contract user allowlist) |
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
- Vector pure overlap 8/16 — hybrid anchors required for 16/16 (shadow diagnostics only)

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

## Post-release roadmap (two lanes)

| Lane | Doc | Status |
| ---- | --- | ------ |
| **Product** (optional) | `P21-10-post-release-product-roadmap.md` | P21.10+ require approval; keyword/rule-engine only |
| **Vector** (blocker burn-down) | `T20-14H0-hybrid-vector-gate-design.md` … `T20-14H2-vector-rollout-decision-package.md` | H0–H2 complete; T20.15A design ready for owner approval |

Product work may continue on keyword/rule-engine. **No product ticket may silently enable vector.**

---

## Next optional tracks (require explicit approval)

| Track | Scope |
| ----- | ----- |
| **P21.10** | Batch seller endpoint design — reduce four parallel retrievals |
| **P21.11** | Persistent session memory design — Redis/DB, multi-pod |
| **P21.12** | Observation-deck integration — feed telemetry JSON into `/observation-deck` |
| **P21.13** | Seller intelligence polish |
| **P21.14** | Dedicated session-memory UI |
| **T20.15A–Q** | Hybrid canary through 25% design | **KEEP allowlist**; percent=0; T20.15R blocked |

Do not start T20.15A implementation without owner approval. Vector rollout remains **NOT APPROVED** for production default.

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED
Vector rollout: NOT APPROVED
Production default: keyword
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT: 0
T20.15R: NOT STARTED
```
