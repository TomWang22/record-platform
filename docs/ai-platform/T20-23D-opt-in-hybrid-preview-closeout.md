# T20.23D — Opt-in hybrid preview closeout

**Status:** T20.23 batch **CLOSED**  
**Generated:** 2026-07-01  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.23C decision (B selected; D and E rejected; preview NOT APPROVED)

---

## 1. Final state

```text
T20.23A–D: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Opt-in preview implementation: NOT APPROVED
Rollout: NOT APPROVED
T20.24A: NOT STARTED
```

---

## 2. Commit map (T20.23A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.23A | `0b47946` | Opt-in hybrid preview design |
| T20.23B | `28fde21` | Sign-off path and evidence audit |
| T20.23C | `12738bc` | Preview decision package (B selected; preview NOT APPROVED) |
| T20.23D | *(this commit)* | Opt-in preview closeout |
| T20.23E | *(pending)* | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored / pure overlap | **16/16 / 8/16** (report-only) |
| T20.22 rollout design | **CLOSED**; rollout **NOT APPROVED** |
| T20.23B audit | **PASS** (no new live inference) |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**D rejected** — opt-in preview implementation not authorized (owner sign-off absent).  
**E rejected** — production default switch not authorized.

---

## 5. Sign-off summary

| Sign-off | Status |
|----------|--------|
| Owner/product | **ABSENT** |
| Engineering | **ABSENT** |
| Privacy | Evidence PASS; formal **ABSENT** |
| Ops/rollback | Runbook documented; formal **ABSENT** |
| Observability | Telemetry 0 WARNs; formal **ABSENT** |
| Support/comms | **ABSENT** |

Sign-off checklist template: `T20-23A-opt-in-hybrid-preview-design.md` §8.

---

## 6. Rollback runbook

1. Remove preview allowlist / disable opt-in flag (if ever enabled)
2. `AI_RAG_HYBRID_CANARY_PERCENT=0`
3. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
4. Image pin: `python-ai-service:t20-p216b`
5. Restore single contract UUID allowlist

---

## 7. Hard stops

- Do **NOT** enable vector production default
- Do **NOT** enable hybrid production default
- Do **NOT** set `PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without eval approval + restore plan
- Do **NOT** implement opt-in preview without owner sign-off
- Do **NOT** start T20.24A without approval phrase
- Pure vector 8/16 remains report-only
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.24A opt-in hybrid preview implementation design only
```

```text
T20.23 opt-in hybrid preview design batch: CLOSED
Opt-in preview implementation: NOT APPROVED
Combined live evidence: 2025/2025 HTTP 200, 0% fallback
```
