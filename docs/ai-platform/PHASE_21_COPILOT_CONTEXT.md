# Phase 21 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-07-02 (T20.32A–H broader opt-in hybrid preview readiness batch CLOSED)  
**Current main SHA:** `6ed60bd`  
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

T20.15A–AG complete. Hybrid canary ladder: CLOSED.
T20.16A–F complete. Hybrid production-readiness batch: CLOSED.
T20.16B final_tagged_plan fallback: fixed (0% fallback on D-LIVE 45/45).
T20.16C pure vector: 8/16 report-only; anchored 16/16.
T20.16D-LIVE: PASS — 45/45 HTTP 200, avg score 4.0, hybrid p95 439 ms.
T20.16E: B selected (KEEP allowlist); C recommended (future soak design).
T20.17A–E complete. Scoped hybrid soak batch: CLOSED.
T20.17C-LIVE: PASS — 90/90 HTTP 200, 0% fallback, avg score 4.0, hybrid p95 223 ms.
T20.17D: B selected (KEEP allowlist); C recommended (broader soak → T20.18A).
T20.18A–E complete. Broader multi-user soak batch: CLOSED.
T20.18C-LIVE: PASS — 270/270 HTTP 200 (6 users), 0% fallback, hybrid p95 146 ms.
T20.18D: B selected (single contract-user allowlist); D recommended (T20.19A).
T20.19A–E complete. Extended multi-window soak batch: CLOSED.
T20.19C-LIVE: PASS — 810/810 HTTP 200 (6 users, 3 windows), 0% fallback, hybrid p95 119 ms.
T20.19D: B selected (single contract-user allowlist); D recommended (T20.20A).
T20.20A–E complete. Hybrid production-decision batch: CLOSED.
T20.20C-LIVE: PASS — 540/540 HTTP 200 (6 users, 2 windows), 0% fallback, hybrid p95 142 ms.
T20.20D: B selected (single contract-user allowlist); D recommended (T20.21A).
T20.21A–D complete. Hybrid default RFC / owner sign-off batch: CLOSED.
T20.21B-LIVE: PASS — 270/270 HTTP 200 (6 users), 0% fallback, hybrid p95 155 ms.
T20.21C: B selected (single contract-user allowlist); E rejected (default switch).
T20.22A–D complete. Hybrid production rollout design batch: CLOSED.
T20.22B audit: PASS (no new live inference).
T20.22C: B selected (single contract-user allowlist); D rejected (rollout NOT APPROVED).
T20.23A–D complete. Opt-in hybrid preview design batch: CLOSED.
T20.23B audit: PASS (no new live inference).
T20.23C: B selected (single contract-user allowlist); D and E rejected (preview NOT APPROVED).
T20.24A–D complete. Opt-in hybrid preview implementation design batch: CLOSED.
T20.24B audit: PASS (no new live inference).
T20.24C: B selected (single contract-user allowlist); D and E rejected (implementation NOT APPROVED).
T20.25A–G complete. Opt-in hybrid preview implementation batch: CLOSED.
T20.25D-LIVE: PASS — 540/540 HTTP 200 (6 users, 2 windows), 0% fallback, hybrid p95 214 ms.
T20.25F: C selected (API-only preview enabled); E rejected (production default).
T20.26A–E complete. Opt-in hybrid preview UI design batch: CLOSED.
T20.26C-LIVE: PASS — 270/270 HTTP 200 (UI-readiness smoke), 0% fallback.
T20.26D: B selected (KEEP API runtime, no UI); C recommended (T20.27A).
T20.27A–H complete. Opt-in hybrid preview UI implementation batch: CLOSED.
T20.27E-LIVE: PASS — 270/270 HTTP 200, 0% fallback, hybrid p95 116 ms.
T20.27G: C selected (KEEP opt-in preview UI); D recommended (T20.28A).
T20.28A–H complete. Post-UI soak batch: CLOSED.
T20.28C-LIVE: PASS — 1080/1080 HTTP 200 (4 windows), 0% fallback, hybrid p95 255 ms.
T20.28F: C selected (KEEP opt-in preview UI); D recommended (T20.29A).
T20.29A–H complete. Participant-limited soak batch: CLOSED.
T20.29C-LIVE: PASS — 2160/2160 HTTP 200 (12 participants, 4 windows), 0% fallback, hybrid p95 176 ms.
T20.29F: C selected (KEEP opt-in preview UI); D recommended (T20.30A).
T20.30A–H complete. Expanded participant soak batch: CLOSED.
T20.30C-LIVE: PASS — 3240/3240 HTTP 200 (12 participants, 6 windows), 0% fallback, hybrid p95 193 ms.
T20.30F: C selected (KEEP opt-in preview UI); D recommended (T20.31A).
T20.31A–H complete. Sustained multi-window soak batch: CLOSED.
T20.31C-LIVE: PASS — 6480/6480 HTTP 200 (12 participants, 12 windows), 0% fallback, hybrid p95 253 ms.
T20.31F: C selected (KEEP opt-in preview UI); D recommended (T20.32A).
T20.32A–H complete. Broader readiness soak batch: CLOSED.
T20.32C-LIVE: PASS — 8640/8640 HTTP 200 (12 participants, 16 windows), 0% fallback, hybrid p95 180 ms.
T20.32F: C selected (KEEP opt-in preview UI); D recommended (T20.33A).
Combined live evidence (D16→D32C): 24705/24705 HTTP 200, 0% fallback.
Hybrid allowlist canary: KEEP.
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f (contract user only).
AI_RAG_HYBRID_CANARY_PERCENT=0.
Production default: keyword.
Vector production default: NOT APPROVED.
Hybrid production default: NOT APPROVED.
API-only opt-in preview: ENABLED (runtime).
Opt-in preview UI: ENABLED on /insights.
Webapp image: webapp:t20-p227b.
Preview enrollments: revoked after eval (safe default).
T20.33A: NOT STARTED — explicit approval required for real-participant opt-in hybrid preview readiness design only.
```

### T20 hybrid canary (implemented)

| Item | Value |
| ---- | ----- |
| Image | `python-ai-service:t20-p225b` |
| Webapp image | `webapp:t20-p227b` |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` (contract only) |
| API-only preview | `GET/POST /api/ai/rag/preview/{status,enroll,revoke}` |
| Combined live (D16→D32C) | **24705/24705** HTTP 200, **0%** fallback |
| Pure overlap | **8/16** (report-only) |
| Anchored overlap | **16/16** |
| Avg quality (C18-LIVE) | **4.0** |

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
Do NOT enable hybrid retrieval as production default.
Do NOT set AI_RAG_HYBRID_CANARY_PERCENT above 0 without explicit owner approval for a scoped eval window.
Do NOT broaden permanent allowlist without explicit approval and restore plan.
Do NOT start T20.33A without: "Approved: start T20.33A real-participant opt-in hybrid preview readiness design only"
Do NOT implement rollout without owner/product sign-off.
Pure vector overlap: report-only per T20.16C — do not promote vector default (8/16).
Do NOT enable vector production default.
Do NOT use generative Ollama as production RAG default.
Do NOT expose message bodies in UI or API responses.

Phase 21 product track is CLOSED and tagged. P21.10+ product follow-ups require explicit approval (keyword/rule-engine only).
T20.16A–F CLOSED: D-LIVE PASS; E selects B+C.
T20.17A–E CLOSED: C-LIVE PASS 90/90; D selects B+D.
T20.18A–E CLOSED: C-LIVE PASS 270/270 (6 users); D selects B+D.
T20.19A–E CLOSED: C-LIVE PASS 810/810 (3 windows); combined live 1215/1215; D selects B+D; single contract allowlist; percent=0; image t20-p216b; production keyword; vector NOT APPROVED.
T20.20A–E CLOSED: C-LIVE PASS 540/540 (2 windows); combined live 1755/1755; D selects B+D; single contract allowlist; percent=0; image t20-p216b; production keyword; vector NOT APPROVED.
T20.21A–D CLOSED: B-LIVE PASS 270/270; combined live 2025/2025; C selects B, rejects E; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED.
T20.22A–D CLOSED: rollout design batch; B audit PASS; C selects B, rejects D; rollout NOT APPROVED; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED; T20.23A NOT STARTED.
T20.23A–D CLOSED: opt-in preview design batch; B audit PASS; C selects B, rejects D+E; preview NOT APPROVED; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED; T20.24A NOT STARTED.
T20.24A–D CLOSED: implementation design batch; B audit PASS; C selects B, rejects D+E; implementation NOT APPROVED at design stage; sign-off required for T20.25.
T20.25A–G CLOSED: sign-off verified; API-only preview implemented; D-LIVE PASS 540/540; F selects C; combined live 2565/2565; image t20-p225b.
T20.26A–E CLOSED: UI design only; B runtime audit PASS; C-LIVE PASS 270/270; D selects B recommends C; UI NOT APPROVED at close.
T20.27A–H CLOSED: UI on /insights; E-LIVE PASS 270/270; G selects C recommends D; webapp t20-p227b; python t20-p225b.
T20.28A–H CLOSED: post-UI soak PASS 1080/1080; F selects C recommends D; combined live 4185/4185.
T20.29A–H CLOSED: participant soak PASS 2160/2160 (12 JWT); F selects C recommends D; combined live 6345/6345.
T20.30A–H CLOSED: expanded soak PASS 3240/3240; cumulative 9585/9585.
T20.31A–H CLOSED: sustained soak PASS 6480/6480; cumulative 16065/16065.
T20.32A–H CLOSED: broader readiness soak PASS 8640/8640.
API-only opt-in preview runtime: KEEP.
Opt-in preview UI: KEEP.
Production default: keyword.
Vector production default: NOT APPROVED.
Hybrid production default: NOT APPROVED.
AI_RAG_HYBRID_CANARY_PERCENT=0.
T20.33A: NOT STARTED.
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
| T20.15 execution (percentage ladder) | **CLOSED** (T20.15A–AG; percent=0 restored after each eval) |
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
| T20.15R 25% gate verify | **COMPLETE** (verification-only) |
| T20.15S 25% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15T 25% decision | **COMPLETE** — Option B active; Option C → U |
| T20.15U 50% design | **COMPLETE** (design only) |
| T20.15V 50% gate verify | **COMPLETE** (verification-only) |
| T20.15W 50% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15X 50% decision | **COMPLETE** — Option B active; Option C → Y |
| T20.15Y 75% design | **COMPLETE** (design only) |
| T20.15Z 75% gate verify | **COMPLETE** (verification-only) |
| T20.15AA 75% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15AB 75% decision | **COMPLETE** — Option B active; Option C → AC |
| T20.15AC 100% design | **COMPLETE** (design only) |
| T20.15AD 100% gate verify | **COMPLETE** (verification-only) |
| T20.15AE 100% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15AF 100% decision | **COMPLETE** — Option B active; Option C → AG |
| T20.15AG ladder closeout | **COMPLETE** |
| T20.16A production-readiness design | **COMPLETE** (design only) |
| T20.16B final_tagged_plan fix | **COMPLETE** (`t20-p216b`) |
| T20.16C pure vector research | **COMPLETE** (8/16 report-only) |
| T20.16D–F production-readiness batch | **COMPLETE** (D-LIVE PASS) |
| T20.17A scoped soak design | **COMPLETE** (design only) |
| T20.17B soak preflight | **COMPLETE** (controls PASS) |
| T20.17C-LIVE scoped soak eval | **COMPLETE** (PASS; 90/90) |
| T20.17D soak decision | **COMPLETE** — Option B active; Option C → T20.18A |
| T20.17E soak closeout | **COMPLETE** |
| T20.18A broader soak design | **COMPLETE** (design only) |
| T20.18B broader soak preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.18C-LIVE broader soak eval | **COMPLETE** (PASS; 270/270, 6 users) |
| T20.18D broader soak decision | **COMPLETE** — Option B active; Option D → T20.19A |
| T20.18E broader soak closeout | **COMPLETE** |
| T20.19A extended soak design | **COMPLETE** (design only) |
| T20.19B extended soak preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.19C-LIVE extended soak eval | **COMPLETE** (PASS; 810/810, 3 windows) |
| T20.19D extended soak decision | **COMPLETE** — Option B active; Option D → T20.20A |
| T20.19E extended soak closeout | **COMPLETE** |
| T20.20A production-decision design | **COMPLETE** (design only) |
| T20.20B production-decision preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.20C-LIVE production-decision verification | **COMPLETE** (PASS; 540/540, 2 windows) |
| T20.20D production-decision package | **COMPLETE** — Option B active; Option D → T20.21A |
| T20.20E production-decision closeout | **COMPLETE** |
| T20.21A hybrid default RFC design | **COMPLETE** (design only) |
| T20.21B RFC live confirmation | **COMPLETE** (PASS; 270/270) |
| T20.21C RFC owner sign-off decision | **COMPLETE** — Option B active; Option E rejected |
| T20.21D RFC closeout | **COMPLETE** |
| Hybrid allowlist canary | **KEEP** (`t20-p216b`, **single** contract user allowlist) |
| T20.22A production-rollout design | **COMPLETE** (design only) |
| T20.22B rollout evidence audit | **COMPLETE** (PASS; no new live inference) |
| T20.22C rollout decision package | **COMPLETE** — Option B active; Option D rejected; rollout NOT APPROVED |
| T20.22D rollout closeout | **COMPLETE** |
| T20.23A opt-in hybrid preview design | **COMPLETE** (design only) |
| T20.23B preview sign-off audit | **COMPLETE** (PASS; no new live inference) |
| T20.23C preview decision package | **COMPLETE** — Option B active; Options D and E rejected; preview NOT APPROVED |
| T20.23D preview closeout | **COMPLETE** |
| T20.24A opt-in preview implementation design | **COMPLETE** (design only) |
| T20.24B implementation sign-off audit | **COMPLETE** (PASS; no new live inference) |
| T20.24C implementation decision package | **COMPLETE** — Option B active; Options D and E rejected; implementation NOT APPROVED |
| T20.24D implementation closeout | **COMPLETE** |
| T20.25A opt-in preview implementation | **NOT STARTED** — requires approval phrase + owner sign-off artifact |
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
| **Vector** (blocker burn-down) | `T20-14H0` … `T20-21D` | H0–H2 complete; T20.15–T20.21 batches CLOSED |

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
| **T20.25A** | Opt-in hybrid preview **implementation** (code/env) | **NOT STARTED** — requires approval phrase + owner sign-off artifact |

Do not start T20.25A without: `Approved: start T20.25A opt-in hybrid preview implementation only after sign-off`. Vector and hybrid production defaults remain **NOT APPROVED**. Default rollout and opt-in preview implementation remain **NOT APPROVED**.

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED
Vector production default: NOT APPROVED
Production default: keyword
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST: 2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT: 0
Image: python-ai-service:t20-p216b
Combined live (D16→D21B): 2025/2025 HTTP 200, 0% fallback
T20.15A–AG: CLOSED (hybrid canary ladder)
T20.16A–F: CLOSED (production-readiness batch)
T20.17A–E: CLOSED (scoped soak; 90/90)
T20.18A–E: CLOSED (broader multi-user soak; 270/270)
T20.19A–E: CLOSED (extended 3-window soak; 810/810)
T20.20A–E: CLOSED (production-decision verification; 540/540)
T20.21A–D: CLOSED (RFC live confirmation; 270/270; default switch REJECTED)
T20.22A–D: CLOSED (rollout design batch; rollout NOT APPROVED)
T20.23A–D: CLOSED (opt-in preview design batch; preview NOT APPROVED)
T20.24A–D: CLOSED (implementation design batch; implementation NOT APPROVED)
T20.25A: NOT STARTED
```
