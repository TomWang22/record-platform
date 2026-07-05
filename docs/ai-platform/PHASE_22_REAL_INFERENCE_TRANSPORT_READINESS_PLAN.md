# Phase 22 — real inference transport readiness plan

**Status:** PLANNING / READINESS ONLY — **NOT STARTED** as live matrix  
**Created:** 2026-07-04  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

This document is a **planning and readiness handoff only**. It does not authorize runtime changes, production-default switches, percentage rollout, allowlist broadening, participant artifact edits, user provisioning, or a new live matrix.

---

## Objective

Phase 22 should focus on **real inference transport readiness** across HTTP/1.1, HTTP/2, and HTTP/3 while preserving Phase 21 locked state.

---

## Baseline (Phase 21 archived)

```text
Phase 21 archived: CLOSED PASS
Archive HEAD: 328161d
Pre-archive validation HEAD: bd76875
Cumulative live matrix: 57105/57105 HTTP 200, 0% fallback
Cumulative live protocol class: HTTP/1.1 runner stack
Additional transport smoke: HTTP/1.1, HTTP/2, HTTP/3 all PASS on contract allowlist RAG path
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

## Phase 22 proposal

Phase 22 must separate evidence into these buckets:

### 1. Matrix evidence

- Real participant matrix count
- Cases by participant count, windows, runs, prompts
- Must report protocol used
- **Never mix protocol-smoke count into matrix total**

The cumulative **57105/57105** count remains the HTTP/1.1 live-eval matrix total from Phase 21 (D16→T20.42C). HTTP/2 and HTTP/3 results are **transport smoke evidence**, not additional matrix cases.

### 2. Transport evidence

- HTTP/1.1 smoke (`curl --http1.1`)
- HTTP/2 smoke (`curl --http2`)
- HTTP/3 smoke (`curl --http3-only`)
- Login + RAG query on contract allowlist path
- Negotiated version captured
- Gate reason captured
- Fallback captured

Read-only smoke script: `scripts/smoke-ai-rag-transport-protocols-readonly.sh`

### 3. Production-readiness evidence

- Telemetry WARNs
- OCH
- Playwright C-suite
- Rollback proof
- Post-revoke proof
- Final env proof

These remain governed by existing T20 closeout patterns; Phase 22 does not reopen Phase 21 matrix totals without explicit approval.

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
```

---

## Suggested Phase 22 workstreams (planning only)

| Workstream | Scope | Status |
| ---------- | ----- | ------ |
| **22A** | Transport readiness design + read-only scripts/docs | This document + archive verification |
| **22B** | Transport validator and smoke only (no live matrix) | NOT STARTED |
| **22C** | Live real-inference matrix (protocol declared per batch) | NOT STARTED — requires 22B PASS + explicit approval |

---

## Next valid approval phrases

**Planning only (no runtime, no live matrix):**

```text
Approved: start Phase 22 planning only — real-inference transport readiness design, no runtime changes, no production default, no live matrix.
```

**Transport validator and smoke only:**

```text
Approved: start Phase 22B real-inference transport validator and smoke only — no live matrix, no runtime changes.
```

**Full Phase 22 live matrix (after 22B PASS):**

```text
Approved: start Phase 22C live real-inference matrix only after Phase 22B transport validator PASS.
```

---

## Hard stops (unchanged from Phase 21)

Do not start T20.43, production-default RFC, PERCENT/ALLOW_PROD_PERCENT rollout, allowlist broadening, participant artifact edits, or user provisioning without explicit owner approval and the correct approval phrase above.
