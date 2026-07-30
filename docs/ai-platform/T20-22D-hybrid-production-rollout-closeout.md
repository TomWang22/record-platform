# T20.22D — Hybrid production rollout closeout

**Status:** T20.22 batch **CLOSED**  
**Generated:** 2026-07-01  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.22C decision (B selected; D rejected; rollout NOT APPROVED)

---

## 1. Final state

```text
T20.22A–D: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Default rollout: NOT APPROVED
T20.23A: NOT STARTED
```

---

## 2. Commit map (T20.22A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.22A | `95f1cfb` | Hybrid production rollout design |
| T20.22B | `85071f5` | Evidence audit + sign-off inventory |
| T20.22C | `e324fd8` | Rollout decision package (B selected, rollout NOT APPROVED) |
| T20.22D | *(this commit)* | Rollout design closeout |
| T20.22E | *(pending)* | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored / pure overlap | **16/16 / 8/16** (report-only) |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |
| T20.22B audit | **PASS** (no new live inference) |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**D rejected** — production default switch not authorized (owner sign-off absent, blockers open).

**Rollout implementation NOT APPROVED.**

---

## 5. Final operational state

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Allowlist | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` **only** |
| PERCENT | **0** |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |
| Hybrid production default | **NOT APPROVED** |

---

## 6. Rollback runbook

1. `AI_RAG_HYBRID_CANARY_PERCENT=0`
2. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
3. Image pin: `python-ai-service:t20-p216b`
4. Restore single contract UUID allowlist

---

## 7. Hard stops

- Do **NOT** enable vector production default
- Do **NOT** enable hybrid production default
- Do **NOT** set `PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without eval approval + restore plan
- Do **NOT** implement rollout without owner sign-off
- Do **NOT** start T20.23A without approval phrase
- Pure vector 8/16 remains report-only
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.23A opt-in hybrid preview design only
```

```text
T20.22 hybrid production rollout design batch: CLOSED
Combined live evidence: 2025/2025 HTTP 200, 0% fallback
Default rollout: NOT APPROVED
```
