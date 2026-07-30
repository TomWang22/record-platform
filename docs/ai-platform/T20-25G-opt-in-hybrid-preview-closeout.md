# T20.25G — Opt-in hybrid preview closeout

**Status:** T20.25 batch **CLOSED**  
**Generated:** 2026-07-01  
**Final image:** `python-ai-service:t20-p225b`

---

## 1. Commit map

| Ticket | Commit | Description |
|--------|--------|-------------|
| Sign-off | `d0e8930` | Owner/product sign-off artifact |
| T20.25A | `7cae149` | Sign-off verification |
| T20.25B | `72038a0` | API-only preview implementation |
| T20.25C | `025d887` | Deploy preflight PASS |
| T20.25D | `b7e7120` | Live eval doc (+ `947a011` e2e/eval runner) |
| T20.25E | `5472cc5` | Rollback drill doc |
| T20.25F | `7106993` | Decision C |
| T20.25G | `ad87e72` | Closeout |
| T20.25H | `819f92e` | PHASE_21 reconciliation |

## 2. Sign-off

`docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md` — Tom Wang / repository owner, 2026-07-01.

## 3. Implementation summary

- Table `ai.ai_rag_preview_enrollment`
- Endpoints: `GET/POST /api/ai/rag/preview/{status,enroll,revoke}`
- Gate: `preview_opt_in` after `allowlist`, PERCENT=0 unchanged
- Tests: `test_t20_25_preview_enrollment` 8/8 PASS
- E2E: UI acceptance accepts `hybrid_canary` for allowlisted contract user

## 4. Live metrics (T20.25D)

| Metric | Value |
|--------|-------|
| Cases | 540/540 HTTP 200 |
| Fallback | 0% |
| `final_tagged_plan` fallback | 0 |
| Avg / worst score | 4.0 / 4.0 |
| Hybrid p95 | 214 ms |
| Combined live (D16→D25D) | **2565/2565** |
| Telemetry WARNs | 0 |
| Leakage / RP | PASS |
| Playwright | PASS |

## 5. Rollback proof (T20.25E)

Revoke → keyword for cohort; allowlist retained; CANARY=0 → all keyword; KEEP restored.

## 6. Decision

**C** — KEEP API-only opt-in preview enabled; PERCENT=0; enrollments revoked post-drill.

## 7. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## 8. Hard stops (unchanged)

No vector/hybrid production default; no PERCENT>0; no UI toggle; no message bodies; no broadened allowlist.

## 9. Next approval phrase

```text
Approved: start T20.26A opt-in hybrid preview UI design only
```
