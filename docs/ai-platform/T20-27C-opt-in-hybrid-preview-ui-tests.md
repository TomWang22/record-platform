# T20.27C — Opt-in hybrid preview UI tests

**Status:** **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`

---

## 1. Test matrix

| Check | Result |
|-------|--------|
| Preview card not-enrolled state | **PASS** (Playwright) |
| Preview card enrolled state | **PASS** (Playwright) |
| Allowlist informational state | **PASS** (Playwright) |
| Enroll button → API → UI update | **PASS** (Playwright) |
| Revoke button → API → UI update | **PASS** (Playwright) |
| API error does not break RAG card | **PASS** (isolated error banner) |
| Guest: no preview card | **PASS** |
| Forbidden copy absent in visible card text | **PASS** |
| Message bodies not rendered | **PASS** (leakage helper) |

## 2. Commands run

| Command | Result |
|---------|--------|
| `npm run lint` | **Skipped** — ESLint not configured interactively in webapp |
| `npx tsc --noEmit` | Pre-existing errors in unrelated analytics modules (not introduced by T20.27) |
| Playwright `e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts` | **4/4 PASS** |

## 3. E2E spec

`webapp/e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts` — cohort enroll/revoke + contract allowlist + guest + API contract.

## 4. Verdict

```text
T20.27C: PASS
T20.27D: AUTHORIZED
```
