# T20.13P — Playwright UI AI/RAG inference acceptance harness

**Status:** Implemented and executed  
**Generated:** 2026-06-27  
**Baseline SHA:** `6423e6c`

---

## Purpose

Browser/UI proof of keyword RAG inference — complements API-level T20.13O-E2E. Exercises:

1. Login at `https://record-platform.test`
2. Navigate to `/insights` (AI Insights dashboard)
3. Type each prompt in `data-testid=ai-rag-question-input`
4. Click **Query**
5. Capture **rendered DOM answer** (`data-testid=ai-rag-summary`)
6. Capture **visible source refs** (`data-testid=ai-source-ref-item`)
7. Capture **network** `/api/ai/rag/query` JSON + timings

---

## Files

| File | Role |
|------|------|
| `webapp/e2e/ai-rag-inference.spec.ts` | Playwright UI walkthrough (7 prompts) |
| `webapp/e2e/helpers/ai-rag.ts` | Prompt list, leakage/scoring, artifact writer |
| `docs/ai-platform/T20-13Q-ui-inference-results.md` | Human-readable results from latest run |

---

## UI route

**`/insights`** — `AiInsightsDashboard` RAG query card (`data-testid=ai-insight-rag`).

Source panel: `AiSourceRefsList` renders truncated `source_type:source_id` refs (not full excerpt bodies).

---

## Run command

```bash
./scripts/webapp-playwright-strict-edge.sh \
  e2e/ai-rag-inference.spec.ts \
  --grep "AI RAG inference UI acceptance"
```

Uses existing edge conventions: `E2E_API_BASE=https://record-platform.test`, `NODE_EXTRA_CA_CERTS=certs/dev-root.pem`, contract user `e2e-contract@record-platform.local`.

---

## Auth note

Uses **fresh edge login** per run (`signInFreshContract`) because stale tokens in `webapp/e2e/.contract-auth-cache.json` cause browser-side `401: invalid token` while API-only tests may still pass.

---

## Assertions (minimum)

- Login succeeds; `/insights` loads
- 7/7 prompts return HTTP 200
- `retrieval_mode=keyword`, `model_used=rule-engine`
- UI answer length > 80 chars; not old boilerplate only
- Synthesis visible (Grounding / Recommended next step / structured lists)
- Source refs present; leakage PASS

---

## Local artifacts (not committed)

```text
bench_logs/ai-platform/ui-inference/<timestamp>.json
bench_logs/ai-platform/ui-inference/<timestamp>.md
bench_logs/ai-platform/ui-inference/raw-<timestamp>/
webapp/test-results/   (Playwright default)
```

Latest successful run: **`20260627-031631`**

---

## Latest run summary

| Metric | Value |
|--------|------:|
| Cases | 7/7 PASS |
| UI p50 / p95 | 2,398 / 7,776 ms |
| API p50 / p95 | 2,024 / 7,017 ms |
| Avg answer chars | 432 |
| Leakage | PASS |
| Old boilerplate | no |

Full transcript: `docs/ai-platform/T20-13Q-ui-inference-results.md`

---

## Final verdict

```text
Production UI keyword RAG: ACCEPTED (browser proof)
Vector rollout: NOT APPROVED
Phase 21: not started
```
