# T20.30D — Expanded opt-in hybrid preview rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-01

---

## 1. UI enroll / revoke (Playwright)

Participant A (cohort0): UI enroll → `preview_opt_in` → UI revoke → `keyword_default` — **PASS**

## 2. API/UI consistency

| Step | Result |
|------|--------|
| API enroll participant B (seller-contract) | **PASS** |
| API revoke participant B | **PASS** |
| Bulk enroll 11 participants | **PASS** |
| Bulk revoke 11 participants | **PASS** |
| All non-allowlist → `keyword_default` | **PASS** |

## 3. `CANARY=0` drill

Contract, cohort, seller → all `keyword` — **PASS**

## 4. KEEP restore

Contract → `hybrid_canary` / `allowlist`; participants → `keyword` / `keyword_default` — **PASS**

## 5. Verdict

```text
T20.30D: PASS
T20.30E: AUTHORIZED
```
