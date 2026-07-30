# T20.24A — Opt-in hybrid preview implementation design

**Status:** Implementation design complete (docs only — **not** code, **not** env, **not** deploy)  
**Generated:** 2026-07-01  
**Baseline SHA:** `7188c28` (T20.23E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.23C decision (B selected; preview implementation NOT APPROVED; owner sign-off absent)

---

## 1. Executive verdict

```text
T20.24A opt-in hybrid preview implementation design: COMPLETE
No code change
No env change
No deploy
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Implementation: NOT APPROVED
T20.25A: NOT STARTED
```

This document defines **how** a future opt-in hybrid preview would be implemented. It does **not** authorize code change, env change, deployment, allowlist broadening, or production default switch.

---

## 2. Evidence baseline

| Evidence | Result |
|----------|--------|
| T20.16D→T20.21B live | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored hybrid overlap | **16/16** |
| Pure vector overlap | **8/16** report-only |
| T20.22 rollout design | **CLOSED**; rollout **NOT APPROVED** |
| T20.23 preview design | **CLOSED**; preview implementation **NOT APPROVED** |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |

---

## 3. Proposed architecture (design only)

### 3.1 Preview enrollment concept

| Component | Design |
|-----------|--------|
| Enrollment store | `ai_rag_preview_enrollment` table or equivalent config document — **owner-scoped rows only** |
| Key fields | `user_id` (UUID), `owner_user_id` (must match JWT subject or verified owner scope), `enrolled_at`, `enrolled_by`, `revoked_at` (nullable), `source` (`owner_opt_in`) |
| Gate integration | Extend hybrid canary gate in `rag_retrieval.py`: after allowlist check, consult enrollment store; enrolled + valid JWT → `hybrid_canary` with `gate_reason=preview_opt_in` |
| Non-enrolled | **keyword** / `keyword_default` — unchanged |
| PERCENT | **Remains 0** — enrollment is explicit only; no percentage assignment |
| Lane | **Hybrid anchored Lane B only** |
| Pure vector | **Report-only** — not enabled by preview enrollment |
| Keyword fallback | **Mandatory** — retained on hybrid path failure |
| Overlap anchors | **Mandatory** — retained |

### 3.2 Owner-scope requirement

- Enrollment row `owner_user_id` must equal authenticated JWT `sub` (or verified account owner).
- Cross-user enrollment by non-owner admins requires separate owner/product approval — **not** in initial implementation scope.
- No anonymous or guest enrollment.

### 3.3 Relationship to existing canary

- Current contract-user allowlist (`2ed75568-…`) **KEEP** unchanged until implementation approved.
- Preview enrollment is **additive** to allowlist logic, not a replacement for production default semantics.
- Rollback: revoke all enrollment rows + restore single allowlist only.

---

## 4. Proposed API/UX behavior (design only)

| Surface | Design |
|---------|--------|
| `GET /ai/rag/preview/status` | Returns `{ enrolled: bool, source: string \| null, gate_reason: string }` for authenticated JWT user only |
| `POST /ai/rag/preview/enroll` | Owner self-enroll only; idempotent; requires valid JWT; **no** automatic enablement on account creation |
| `POST /ai/rag/preview/revoke` | Owner self-revoke; immediate return to keyword default |
| UI | **No** preview toggle in initial scope (T20.24 hard stop) — API-only enrollment when implementation approved |
| Anonymous/guest | Denied or keyword default — no preview path |
| Message bodies | **Not exposed** in any preview response |
| Identity | JWT only — **no** header-spoofed user IDs |

---

## 5. Proposed telemetry (design only)

Extend quality telemetry JSON per RAG request:

| Field | Type | Purpose |
|-------|------|---------|
| `preview_opt_in` | bool | Whether user was enrolled at request time |
| `preview_source` | string \| null | e.g. `owner_opt_in`, `allowlist` (legacy canary) |
| `gate_reason` | string | `preview_opt_in`, `allowlist`, `keyword_default`, etc. |
| `retrieval_mode` | string | `hybrid_canary`, `keyword`, etc. |
| `fallback_reason` | string \| null | If keyword fallback triggered |
| `latency_ms` | number | Request latency |
| `latency_p50` / `latency_p95` | aggregate | Rollup in telemetry report |
| `source_refs_count` | number | Retrieved source count |
| `leakage_result` | string | `PASS` / `FAIL` from existing leakage scan |

---

## 6. Proposed tests (design only)

| Test case | Expected |
|-----------|----------|
| Non-enrolled JWT user | `retrieval_mode=keyword`, `gate_reason=keyword_default` |
| Enrolled JWT user (owner scope) | `retrieval_mode=hybrid_canary`, `gate_reason=preview_opt_in` |
| Enrolled user, wrong owner scope | Denied enroll or keyword default |
| Anonymous/guest request | Denied or keyword default |
| Response payload | No message bodies in sources or excerpts |
| Hybrid failure path | Keyword fallback retained |
| Revoked enrollment | Immediate return to keyword |
| Rollback drill | All enrollments revoked; allowlist restored; PERCENT=0 |
| Contract allowlist user | Unchanged behavior (`allowlist` gate) during coexistence |

---

## 7. Required sign-offs before any implementation

| Sign-off | Required | Current status |
|----------|----------|----------------|
| Owner/product | Yes | **ABSENT** |
| Engineering | Yes | **ABSENT** |
| Privacy/leakage | Yes | Evidence PASS; formal **ABSENT** |
| Ops/rollback | Yes | Runbook documented; formal **ABSENT** |
| Observability | Yes | Telemetry 0 WARNs; formal **ABSENT** |
| Support/comms | Yes | **ABSENT** |

---

## 8. Owner/product sign-off artifact template (for T20.25A)

When implementation is requested, owner/product must commit an artifact such as:

`docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md`

```markdown
# Owner/product sign-off — opt-in hybrid preview implementation

**Approver name:**
**Approver role:** Owner / Product
**Date (UTC):**
**Baseline SHA:** (T20.24D closeout or later)
**Scope:** Opt-in hybrid preview implementation only

## Explicitly approved
- [ ] Non-default preview enrollment (owner self-opt-in, JWT only)
- [ ] Hybrid anchored Lane B for enrolled users only
- [ ] PERCENT remains 0
- [ ] Keyword default unchanged for non-enrolled users
- [ ] Rollback runbook (T20.24D)

## Explicitly NOT approved
- [ ] Hybrid production default
- [ ] Vector production default
- [ ] PERCENT > 0
- [ ] Broadened permanent allowlist without scoped eval + restore
- [ ] UI preview toggle (unless separately approved)
- [ ] Message body exposure

## Evidence acknowledged
- Combined live 2025/2025, 0% fallback
- Pure vector 8/16 report-only
- Anchored 16/16

**Signature / approval reference:** (PR link, issue, or signed commit message)
```

No implementation ticket (T20.25A) may proceed without this artifact or equivalent recorded in repo.

---

## 9. Stop condition

```text
Implementation: NOT APPROVED
T20.24B implementation sign-off gate audit: AUTHORIZED
T20.25A: NOT STARTED
```

No code, env, image, or allowlist changes until owner/product sign-off artifact exists and explicit T20.25A approval phrase is issued.
