# T20.28G — Opt-in hybrid preview post-UI soak closeout

**Status:** T20.28 batch **CLOSED**  
**Generated:** 2026-07-01

---

## 1. Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.28A | `8005d82` | Post-UI soak design |
| T20.28B | `a1e0f3a` | Preflight PASS + E2E stabilization |
| T20.28C | (this batch) | Live soak 1080/1080 |
| T20.28D | (this batch) | Rollback drill |
| T20.28E | (this batch) | Telemetry audit |
| T20.28F | (this batch) | Decision C |
| T20.28G | (this batch) | Closeout |

## 2. Images

| Service | Image |
|---------|-------|
| webapp | `webapp:t20-p227b` |
| python-ai-service | `python-ai-service:t20-p225b` (unchanged) |

## 3. Changed files

- `scripts/t20-25d-opt-in-preview-eval.py` — per-window enrollment reset for soak
- `webapp/e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts` — API revoke precondition + enroll wait

## 4. Live metrics (T20.28C)

1080/1080 HTTP 200, 0% fallback, gate_reason allowlist 180 / preview_opt_in 900. Cumulative **4185/4185**.

## 5. Decision

**C** — KEEP opt-in preview UI; recommend T20.29A participant-limited soak design.

## 6. Next track

```text
Approved: start T20.29A participant-limited opt-in hybrid preview soak design only
```
