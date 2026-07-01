# T20.27H — Opt-in hybrid preview UI closeout

**Status:** T20.27 batch **CLOSED**  
**Generated:** 2026-07-01

---

## 1. Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.27A | `4cfe345` | Implementation plan |
| T20.27B | `79408ce` + `4dbb215` | UI + fixes |
| T20.27C/D | `7cf5882` | Tests + preflight |
| T20.27E | (this batch) | Live eval 270/270 |
| T20.27F | (this batch) | Rollback drill |
| T20.27G | (this batch) | Decision C |
| T20.27H | (this batch) | Closeout |

## 2. Images

| Service | Image |
|---------|-------|
| webapp | `webapp:t20-p227b` |
| python-ai-service | `python-ai-service:t20-p225b` (unchanged) |

## 3. Changed files (UI)

- `webapp/components/ai/opt-in-hybrid-preview-card.tsx`
- `webapp/components/ai/ai-insights-dashboard.tsx`
- `webapp/lib/ai-insights-client.ts`
- `webapp/lib/ai-insights-types.ts`
- `webapp/e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts`

## 4. Live metrics (T20.27E)

270/270 HTTP 200, 0% fallback, gate_reason allowlist 45 / preview_opt_in 225. Cumulative **3105/3105**.

## 5. Decision

**C** — KEEP opt-in preview UI enabled; recommend T20.28A soak design.

## 6. Next track

```text
Approved: start T20.28A opt-in hybrid preview post-UI soak design only
```
