# T20.26A — Opt-in hybrid preview UI design

**Status:** Design complete (docs only — **no** UI code, **no** toggle implementation, **no** default switch)  
**Generated:** 2026-07-01  
**Baseline SHA:** `4d84c55` (T20.25H closeout)  
**Image:** `python-ai-service:t20-p225b` (unchanged)  
**Parent:** T20.25F decision (C selected; API-only preview ENABLED; T20.26A authorized)

---

## 1. Executive verdict

```text
T20.26A opt-in hybrid preview UI design: COMPLETE
No UI implementation
No env change
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only preview runtime: KEEP (T20.25)
UI preview implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.27A: NOT STARTED
```

This document defines the **future UI** for the already-shipped API-only preview runtime. It does **not** authorize UI code, env change, allowlist broadening, percentage rollout, or production default switch.

---

## 2. Runtime baseline (shipped T20.25)

| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/ai/rag/preview/status` | GET | JWT `x-user-id` |
| `/api/ai/rag/preview/enroll` | POST | JWT `x-user-id` |
| `/api/ai/rag/preview/revoke` | POST | JWT `x-user-id` |

| User state | RAG `retrieval_mode` | `gate_reason` |
|------------|----------------------|---------------|
| Non-enrolled authenticated | `keyword` | `keyword_default` |
| Preview enrolled | `hybrid_canary` | `preview_opt_in` |
| Contract allowlist | `hybrid_canary` | `allowlist` (highest priority) |
| Revoked enrollment | `keyword` | `keyword_default` |
| Anonymous / guest | denied or keyword | never hybrid |

---

## 3. Proposed UI surfaces (design only)

### 3.1 `/insights` preview status card

| Element | Design |
|---------|--------|
| Placement | Below or beside existing RAG panel on `/insights`; does not replace RAG query UI |
| Visibility | Authenticated users only; hidden for anonymous/guest |
| States | **Not enrolled** · **Enrolled (preview active)** · **Revoked / disabled** · **Allowlist (informational)** |
| Primary copy | “Hybrid preview is opt-in; keyword remains the default for everyone who has not enrolled.” |
| Allowlist user | Show informational badge: “You are on the engineering allowlist canary. Preview enrollment is optional and does not change your retrieval path.” |
| Loading | Skeleton while `GET /preview/status` in flight |
| Error | Non-blocking banner if status API degraded; RAG query unaffected |

### 3.2 Enroll CTA (design only — implementation NOT approved)

| Property | Design |
|----------|--------|
| Label | “Enable hybrid preview (opt-in)” |
| Confirmation | Modal: “This enables hybrid retrieval for your account only. Keyword remains the platform default. You can revoke anytime.” |
| Action | `POST /api/ai/rag/preview/enroll` on confirm |
| Post-enroll | Refresh status card; next RAG query should show `preview_opt_in` in diagnostics (dev/contract surfaces only) |
| Disabled when | Already enrolled; unauthenticated; status API unavailable |

### 3.3 Revoke CTA (design only — implementation NOT approved)

| Property | Design |
|----------|--------|
| Label | “Disable hybrid preview” |
| Confirmation | Modal: “You will return to keyword retrieval. This does not affect platform defaults.” |
| Action | `POST /api/ai/rag/preview/revoke` on confirm |
| Post-revoke | Status card → not enrolled; RAG returns `keyword_default` |

### 3.4 Evidence copy (required strings)

- “Hybrid preview is opt-in; keyword remains default.”
- “Preview is non-default and reversible.”
- “This does not change production retrieval defaults.”
- “Private message content is never shown in AI responses.”

### 3.5 Forbidden UI language

- “Production default” / “now default for all users”
- “Automatic rollout” / “percentage” / “canary rollout”
- Any toggle that implies platform-wide hybrid or vector default
- Display of message bodies, thread text, or proxy bid internals

---

## 4. Telemetry (future UI)

| Event | Fields |
|-------|--------|
| `preview_status_view` | `user_id`, `enrolled`, `gate_reason`, `source` |
| `preview_enroll_attempt` | `user_id`, `http_status`, `latency_ms` |
| `preview_enroll_success` | `user_id`, `enrolled_at`, `source` |
| `preview_revoke_attempt` | `user_id`, `http_status` |
| `preview_revoke_success` | `user_id`, `revoked_at` |
| RAG post-preview | `gate_reason`, `retrieval_mode`, `fallback_reason`, `latency_ms`, `source_refs_count`, `leakage_result` |

All telemetry must respect existing privacy filters. No message-body fields.

---

## 5. Safety and rollback (UI design)

| Control | Design |
|---------|--------|
| Revoke | One-click revoke always visible when enrolled |
| Rollback (ops) | UI is additive; ops rollback = revoke enrollments + KEEP env (documented T20.25E) |
| Allowlist | UI must not offer “enroll” as a way to broaden allowlist; allowlist is ops-controlled |
| PERCENT | UI must not surface or edit `AI_RAG_HYBRID_CANARY_PERCENT` |

---

## 6. Acceptance criteria (future T20.27A implementation)

| ID | Criterion |
|----|-----------|
| AC-1 | Status card reflects `GET /preview/status` for authenticated JWT user |
| AC-2 | Non-enrolled user RAG remains `keyword` / `keyword_default` |
| AC-3 | Enroll flow calls API only; post-enroll RAG is `hybrid_canary` / `preview_opt_in` |
| AC-4 | Revoke flow restores `keyword` / `keyword_default` |
| AC-5 | Allowlist user retains `allowlist` regardless of enroll state |
| AC-6 | No message bodies in UI or API excerpts shown to user |
| AC-7 | Copy includes non-default / opt-in language; no production-default implication |
| AC-8 | Anonymous/guest never sees enroll or hybrid preview surfaces |
| AC-9 | Playwright covers status card states (mocked or contract env) without enabling PERCENT>0 |
| AC-10 | Enrollments revocable; post-revoke keyword verified in E2E |

---

## 7. Test plan (design — for T20.27A)

| Layer | Scope |
|-------|--------|
| Contract | Preview status/enroll/revoke API envelopes |
| Integration | Enroll → RAG `preview_opt_in`; revoke → `keyword_default` |
| E2E | `/insights` status card states; no hybrid for logged-out user |
| Regression | Existing seller intelligence + RAG Playwright suites remain PASS |
| Live smoke | Repeat T20.26C matrix after UI ships |

---

## 8. Hard stops (unchanged)

- No UI code in T20.26
- No UI toggle implementation
- `AI_RAG_HYBRID_CANARY_PERCENT=0`
- No allowlist broadening
- No vector/hybrid production default
- No message-body exposure
- T20.27A requires separate approval phrase
