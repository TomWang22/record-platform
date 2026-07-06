# Phase 22 — real inference + transport readiness plan

**Status:** Phase 22 CLOSED PASS — full labeled protocol parity H1/H2/H3 each **57105/57105**  
**Created:** 2026-07-04  
**Updated:** 2026-07-06 (Phase 22I H2 + 22J H3 full 57105 replay PASS + 22K closeout)  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

This document is a **planning and readiness handoff only**. It does not authorize runtime changes, production-default switches, percentage rollout, allowlist broadening, participant artifact edits, user provisioning, or a new live matrix.

See also: `docs/ai-platform/PHASE_22A_REAL_INFERENCE_RESPONSE_VALIDATION_DESIGN.md`, `docs/ai-platform/PHASE_22B_REAL_INFERENCE_RESPONSE_TRANSPORT_VALIDATOR.md`, `docs/ai-platform/PHASE_22_KPI_OBSERVABILITY_READINESS.md`

---

## Objective

Phase 22 focuses on **real inference transport readiness** and **response intelligence correctness** across HTTP/1.1, HTTP/2, and HTTP/3 while preserving Phase 21 locked state.

Phase 22 is **not** just “does the endpoint return 200.” It must validate response bodies, sentiment/intent signals, negotiation safety, and protocol transport evidence — without merging protocol-smoke counts into the **57105/57105** matrix total.

---

## Baseline (Phase 21 archived)

```text
Phase 21 archived: CLOSED PASS
Archive HEAD: 328161d
Pre-archive validation HEAD: bd76875
Handoff commit: b17953a
Cumulative live matrix: 57105/57105 HTTP 200, 0% fallback
Cumulative live protocol class: HTTP/1.1 runner stack only
Transport smoke: HTTP/1.1, HTTP/2, HTTP/3 PASS on contract allowlist RAG path
Production default: keyword
Preview UI/API: KEEP
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

See also: `docs/ai-platform/PHASE_21_ARCHIVE_READONLY_VERIFICATION.md`, `docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md`.

---

## Phase 22 evidence buckets

Phase 22 must separate evidence into these buckets:

### 1. Matrix evidence

- Real participant matrix count
- Cases by participant count, windows, runs, prompts
- Must report protocol used
- **Never mix protocol-smoke count into matrix total**

The cumulative **57105/57105** count remains the HTTP/1.1 live-eval matrix total from Phase 21 (D16→T20.42C).

### 2. Transport evidence

- HTTP/1.1 smoke (`curl --http1.1`)
- HTTP/2 smoke (`curl --http2`)
- HTTP/3 smoke (`curl --http3-only`)
- Login + RAG query on contract allowlist path
- Negotiated version captured
- Gate reason captured
- Fallback captured

Script: `scripts/smoke-ai-rag-transport-protocols-readonly.sh`

### 3. Real inference response evidence (Phase 22A+)

- Response text exists and is non-placeholder
- Actionable seller/buyer guidance when expected
- Structured metadata (`retrieval_mode`, `gate_reason`, excerpts)
- No fallback / leakage / overclaim
- Sentiment / intent / negotiation checks per case
- Same assertions repeated on **each protocol** (H1/H2/H3)

Script: `scripts/smoke-ai-rag-real-inference-response-readonly.sh`

### 4. Production-readiness evidence

- Telemetry WARNs
- OCH
- Playwright C-suite
- Rollback proof
- Post-revoke proof
- Final env proof

These remain governed by existing T20 closeout patterns; Phase 22 does not reopen Phase 21 matrix totals without explicit approval.

### 5. KPI / observability evidence (Phase 22B+)

Separate from matrix totals and from H1/H2/H3 smoke counts:

- Recommendation usefulness / rubric pass rates over time
- Retrieval latency baselines (`rag_total_ms`, hybrid latency when exposed)
- Ingestion pipeline success rates (defined; instrumentation gaps documented)
- Data-to-searchable lifecycle timing (defined; no invented data)
- Operational health gates (uptime, error rates, fallback, telemetry, OCH)

See: `docs/ai-platform/PHASE_22_KPI_OBSERVABILITY_READINESS.md`  
Summarizer: `scripts/summarize-phase22-ai-kpis-readonly.mjs`

---

## Phase 22 protocol test requirement

Every Phase 22 live-readiness batch must include:

```text
HTTP/1.1 explicit smoke: PASS
HTTP/2 explicit smoke: PASS
HTTP/3 explicit smoke: PASS
```

For any future live matrix, document:

```text
Matrix protocol:
Transport smoke protocols:
Whether H2/H3 were smoke-only or full matrix:
```

---

## Phase 22 use-case coverage (smoke suite)

| case_id | intent | protocols |
| ------- | ------ | --------- |
| seller_listing_advice | seller_guidance | H1, H2, H3 |
| buyer_sentiment | sentiment_analysis | H1, H2, H3 |
| negotiation_strategy | negotiation | H1, H2, H3 |
| auction_pressure | auction_strategy | H1, H2, H3 |
| red_team_overclaim | safety_refusal | H1, H2, H3 |

Full case JSON: `PHASE_22A_REAL_INFERENCE_RESPONSE_VALIDATION_DESIGN.md`

---

## Explicit non-goals

```text
No production default.
No PERCENT rollout.
No ALLOW_PROD_PERCENT rollout.
No permanent allowlist broadening.
No artifact edits unless explicitly approved.
No user provisioning unless explicitly approved.
No staging/test users counted as real participants.
No message-body exposure.
No anonymous/guest hybrid.
No runtime/env/image/default/allowlist changes without separate approval.
No adding protocol-smoke probes to 57105 cumulative matrix.
```

---

## Phase 22 workstreams

| Workstream | Scope | Status |
| ---------- | ----- | ------ |
| **22A** | Response validation design + read-only scripts/docs | **COMPLETE** @ `21f46c4` |
| **22B** | Response + transport validator smoke + KPI readiness | **PASS** @ `0f49545` |
| **22C** | Protocol-parity live matrix (H1/H2/H3) | **PASS 7200/7200** |
| **22D** | Rollback drill | **PASS** |
| **22E** | KPI telemetry audit | **PASS** |
| **22F** | Decision C KEEP | **SELECTED** |
| **22G** | Closeout | **CLOSED PASS** |
| **22H** | Full 57105 replay manifest + design | **PASS** |
| **22I** | H2 full 57105 replay | **PASS 57105/57105** |
| **22J** | H3 full 57105 replay | **PASS 57105/57105** |
| **22K** | Full protocol parity closeout | **CLOSED PASS** |

---

## Full protocol parity (22I–K — COMPLETE)

```text
Phase 21 H1 baseline: 57105/57105 HTTP/1.1 — historical, not re-run
Phase 22I H2 replay:  57105/57105 HTTP/2 explicit — PASS
Phase 22J H3 replay:  57105/57105 HTTP/3 explicit — PASS
Full labeled protocol parity: PASS
Phase 22C sample: 7200/7200 — sample only
```

See: `PHASE_22I_H2_FULL_57105_REPLAY.md`, `PHASE_22J_H3_FULL_57105_REPLAY.md`, `PHASE_22K_FULL_PROTOCOL_PARITY_CLOSEOUT.md`

---

## Next valid approval phrases

**Planning only (22A — complete):**

```text
Approved: start Phase 22 planning only — real-inference transport readiness design, no runtime changes, no production default, no live matrix.
```

**Response + transport validator smoke only (22B):**

```text
Approved: start Phase 22B real-inference response and transport validator smoke only — no live matrix, no runtime changes.
```

**Full Phase 22 live matrix (22C — after 22B PASS):**

```text
Approved: start Phase 22C live real-inference matrix only after Phase 22B response+transport validator PASS.
```

**H2 full 57105 replay (22I — after 22H manifest PASS):**

```text
Approved: start Phase 22I HTTP/2 full 57105 real-inference replay only after Phase 22H replay manifest PASS.
```

**H3 full 57105 replay (22J — after 22I PASS):**

```text
Approved: start Phase 22J HTTP/3 full 57105 real-inference replay only after Phase 22I HTTP/2 replay PASS.
```

---

## Hard stops (unchanged from Phase 21)

Do not start T20.43, production-default RFC, PERCENT/ALLOW_PROD_PERCENT rollout, allowlist broadening, participant artifact edits, or user provisioning without explicit owner approval and the correct approval phrase above.

---

## Read-only verification

```bash
bash scripts/verify-phase-21-archive-readonly.sh
bash scripts/smoke-ai-rag-transport-protocols-readonly.sh   # requires CONTRACT_PASSWORD
bash scripts/smoke-ai-rag-real-inference-response-readonly.sh
node scripts/summarize-phase22-ai-kpis-readonly.mjs
```
