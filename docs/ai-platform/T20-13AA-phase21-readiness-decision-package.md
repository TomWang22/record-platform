# T20.13AA — Phase 21 readiness decision package

**Status:** Docs-only decision package  
**Generated:** 2026-06-27  
**Baseline SHA:** `590494e`  
**Prior:** T20.13X/Y/Z structured record intelligence (`73b9b5b`–`590494e`)

---

## Executive decision

```text
Vector rollout path: NOT READY
Non-vector product Phase 21 path: READY FOR OWNER APPROVAL
Phase 21: not started
```

**Recommendation:** Approve **Phase 21 on a non-vector product track** only. Keep **T20.14/T20.15 vector rollout blocked** until shadow latency and overlap gates clear. Phase 21 scope must explicitly exclude vector default, hybrid rollout, and embedding tranches unless separately approved.

**Rationale:** Post T20.13X/Y/Z, keyword + rule-engine + structured seller intelligence meets product quality gates (record intelligence 3.57/5, longform 3.58/5, final tagged plan 4.0/5). Vector shadow remains unsuitable for production default (p95 6–9s vs 3s SLO; weak chunk overlap). These are **independent paths** — product work does not require vector rollout.

---

## Current accepted capabilities

| Capability | Evidence | Status |
| ---------- | -------- | ------ |
| Embedded count ≥10k | 10,065 (~13.8% of corpus; count gate per T20.13L) | PASS |
| Keyword RAG synthesis | 3.6/5 generic UI (T20.13J/Q); longform 3.58/5 post T20.13Z | PASS |
| Record intelligence | 3.57/5 avg, 7/7 UI render (T20.13Z `20260627-043358`) | PASS |
| Longform seller session | 3.58/5 avg, 12/12 hard-pass (T20.13Z `20260627-043448`) | PASS |
| Final tagged plan | 4.0/5 — `[grounded]` / `[missing evidence]` / `[needs manual review]` (turn 12) | PASS |
| Structured seller endpoints | `listing_advice`, `negotiation_strategy`, `auction_pressure`, `collector_metadata_gaps` live | PASS |
| UI browser flow | Playwright 7/7 record intelligence + 12/12 longform | PASS |
| HTTP/2 | curl + browser h2 on `/insights` (T20.13U) | PASS |
| HTTP/3 | curl `--http3-only` on edge (T20.13U) | PASS |
| Leakage | 0 failures across UI suites; message bodies excluded | PASS |
| Contracts/readiness | RAG, runtime, endpoints, provider, pgvector, OCH decontaminate (T20.13Z) | PASS |
| Production retrieval | `keyword`; `model_used=rule-engine` | PASS |
| Event/proto contracts | Proto ↔ 15 topics, producer/consumer audit (T20.13U) | PASS |
| AI RAG sync path | No Kafka/event completion dependency for `/api/ai/rag/query` | PASS |

**Not required for non-vector Phase 21:** shadow p95 ≤3s, shadow–keyword chunk overlap, vector default, hybrid rollout.

---

## Remaining blockers

### Vector rollout blockers (Path A — T20.14/T20.15)

| Blocker | Evidence | Classification |
| ------- | -------- | -------------- |
| Shadow p95 latency above 3s SLO | 6,057–9,434 ms warmed (T20.13L); embed + candidate_fetch mixed bound | **blocker** for vector rollout |
| Weak shadow–keyword chunk overlap | ~12/16 zero chunk overlap benchmark (T20.10G); ~1/7 off in live eval (T20.13N) | **blocker** for vector rollout |
| Flagged overlap diagnostic-only | Adds latency (cf p95 ~6.7s); not production-default | **blocker** for default-on overlap |
| Percent embedded coverage | ~13.8% vs 15% alternate gate (count gate passes at 10,065) | **blocker** for vector-only promotion narrative |
| No ANN index | Exact vector sort at ~10k rows (T20.13L Option D) | **blocker** for vector scale |
| Ollama embed variance | Warmup p95 spikes ~25s (T20.13L) | **blocker** for vector reliability |
| T20.14/T20.15 not approved | No signed promotion gate or rollback plan for vector | **blocker** |

**Path A verdict:** **NOT READY** — do not start T20.14/T20.15 or enable vector default.

### Non-vector Phase 21 blockers (Path B)

| Item | Evidence | Classification |
| ---- | -------- | -------------- |
| No server-side conversational memory | Longform turns 10–12 use client-accumulated prompt text (T20.13Z) | **acceptable known limitation** → follow-up **P21.3** |
| Collector metadata partial in some longform turns | Turn 6 scored 3.0/5; record-intel collector case 4.0/5 (T20.13Z) | **acceptable known limitation** → follow-up **P21.4** |
| UI source panel shows refs, not full excerpts | `source_type:id` truncated in DOM (T20.13U) | **follow-up ticket** → **P21.2** |
| Event pipeline partial checks | transport-watchdog throttle warnings; Kafka partition verify SKIP in dev (T20.13U) | **acceptable known limitation** for sync AI path |
| Intent routing edge cases | Some prompts hit adjacent templates (e.g. listing revision vs listing advice) | **follow-up ticket** — polish, not gate |
| Percent coverage below 15% | 13.8% embedded | **acceptable** for keyword-only Phase 21; **blocker** only if Phase 21 attempted vector |

**Path B verdict:** No **hard blockers** remain for a keyword-only product Phase 21. Remaining items are scoped follow-ups inside Phase 21, not pre-start gates.

---

## Phase 21 allowed scope if approved

Phase 21 may include:

```text
Phase 21 may include:
- productizing structured seller intelligence
- UI improvements for listing advice / negotiation / auction pressure
- source evidence display improvements
- server-side conversation/session memory design
- collector metadata extraction
- observability dashboards for AI answer quality
```

Phase 21 must exclude:

```text
- vector default rollout
- hybrid rollout
- default-on overlap flags
- embedding tranches unless separately approved
- ANN index changes unless separately approved
```

**Explicit track name:** **Phase 21 — non-vector product track**

---

## Required pre-Phase-21 checklist

Before starting Phase 21 implementation, require:

- [ ] **Owner approval** of this decision package (T20.13AA)
- [ ] Phase 21 charter states **“non-vector product track”** in title and scope
- [ ] Rollback / feature flags for new UI surfaces (structured panels, session memory)
- [ ] Existing keyword retrieval + rule-engine synthesis path preserved as fallback
- [ ] No production env changes enabling vector (`AI_RAG_SHADOW_VECTOR` remains off by default)
- [ ] No Phase 21 task may flip `AI_RAG_SHADOW_VECTOR=1` or change retrieval default to vector
- [ ] T20.14/T20.15 remain **out of scope** until separately approved after vector gates pass

---

## Recommended first Phase 21 tickets

### P21.1 — Seller intelligence UI surfaces

Dedicated panels wired to structured endpoints:

- Listing advice (`/api/ai/seller/listing-advice`)
- Negotiation strategy (`/api/ai/seller/negotiation-strategy`)
- Auction pressure (`/api/ai/seller/auction-pressure`)
- Collector metadata gaps (`/api/ai/seller/collector-metadata-gaps`)

Feature-flagged; keyword/rule-engine backend only.

### P21.2 — Source evidence UX

Show full sanitized source excerpts in UI (from `details.excerpts`), not only truncated `source_type:id` refs. Preserve leakage filters; no message bodies.

### P21.3 — Session memory design

Server-side conversation state for longform seller workflows (preferences, tradeoffs, prior turn summaries). Client prompt accumulation remains fallback. **No generative or vector rollout required.**

### P21.4 — Collector metadata extraction

Field-level extraction and display for pressing, condition, provenance, scarcity — per-listing depth beyond rule-engine scan. Improves longform turn 6 and listing edit flows.

### P21.5 — AI quality telemetry dashboard

Grafana (or observation-deck extension): domain scenario scores, latency p50/p95, leakage, endpoint health, synthesis template distribution. Feed from Playwright artifact JSON + contract audit outputs.

---

## Gate decision

| Track | Status | Reason |
| ----- | ------ | ------ |
| T20.14/T20.15 vector rollout | **BLOCKED** | Shadow p95 6–9s; weak overlap; no promotion gate |
| Phase 21 non-vector product | **READY FOR OWNER APPROVAL** | Keyword + structured intelligence passes quality gates; leakage/contracts PASS |
| Phase 21 vector product | **BLOCKED** | Vector rollout not approved; must not bundle with product track |

---

## Evidence references

| Artifact | Location |
| -------- | -------- |
| Post-intelligence scoreboard | `docs/ai-platform/T20-13Z-post-intelligence-gauntlet-scoreboard.md` |
| Structured endpoints | `docs/ai-platform/T20-13Y-structured-seller-intelligence-endpoints.md` |
| Longform synthesis | `docs/ai-platform/T20-13X-longform-synthesis-improvements.md` |
| Protocol + pipeline | `docs/ai-platform/T20-13U-protocol-pipeline-rag-acceptance.md` |
| Shadow latency gates | `docs/ai-platform/T20-13L-shadow-latency-remediation-plan.md` |
| Prior runway map | `docs/ai-platform/T20-13N-phase21-runway.md` (superseded for Path B by this package) |

Local run artifacts (not committed): `bench_logs/ai-platform/ui-record-intelligence/20260627-043358/`, `bench_logs/ai-platform/longform-rag-session/20260627-043448/`.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
Phase 21: NOT STARTED
Non-vector Phase 21 track: READY FOR OWNER APPROVAL
```

**Next action:** Owner signs Phase 21 charter on non-vector track → start P21.1. Do **not** start T20.14/T20.15 or Phase 21 vector work in parallel.
