# T20.29D — Participant-limited opt-in hybrid preview rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-01

---

## 1. UI enroll / revoke (Playwright)

| Step | Result |
|------|--------|
| Participant A (cohort0) UI enroll | **PASS** |
| RAG → `preview_opt_in` | **PASS** |
| Participant A UI revoke | **PASS** |
| RAG → `keyword_default` | **PASS** |

## 2. API/UI consistency

| Step | Result |
|------|--------|
| API enroll participant B (seller-contract) | **PASS** |
| API revoke participant B | **PASS** |
| Revoke all participants | **PASS** |
| All non-allowlist → `keyword_default` | **PASS** |

## 3. `CANARY=0` drill

| Step | Result |
|------|--------|
| Contract → `keyword` | **PASS** |
| Cohort → `keyword` | **PASS** |
| Seller → `keyword` | **PASS** |

## 4. KEEP restore

Contract → `hybrid_canary` / `allowlist`; cohort → `keyword` / `keyword_default` — **PASS**

## 5. Verdict

```text
T20.29D: PASS
T20.29E: AUTHORIZED
```
