# T20.19A — Extended hybrid soak design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `27d60e9` (T20.18E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.18D decision (B selected; D recommended → this extended soak)

---

## 1. Executive verdict

```text
T20.19A extended hybrid soak design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user operationally)
AI_RAG_HYBRID_CANARY_PERCENT=0
Extended multi-window live soak: NOT STARTED (T20.19B → T20.19C)
```

T20.18 proved **6 JWT users × 270 cases** with 0% fallback. T20.19 repeats that matrix across **3 live windows** (target **810** cases) while keeping `PERCENT=0` and restoring single contract-user allowlist after eval.

---

## 2. Objective

- **Repeated multi-user live inference windows** (3×)
- **PERCENT=0** throughout — no percentage rollout
- **No production default change**
- Temporary 6-user allowlist during eval windows only
- Restore **single contract-user allowlist** unless T20.19D explicitly selects broader KEEP

---

## 3. Cohort (6 JWT users)

| Email | UUID |
|-------|------|
| e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| t20-15g-cohort0@record-platform.local | `00000040-0000-4000-8000-000000000000` |
| t20-15k-cohort1@record-platform.local | `0000002a-0000-4000-8000-000000000000` |
| buyer-contract@record-platform.local | `5a68fe88-c134-4166-b145-57534a3656b9` |
| t20-15o-bucket10@record-platform.local | `000001bc-0000-4000-8000-000000000000` |
| t20-15s-bucket20@record-platform.local | `00000002-0000-4000-8000-000000000000` |

Auth: JWT login (`ContractPass123!`). JWT `sub` must match UUID — **no header spoofing**.

---

## 4. Eval windows

| Window | Users | Runs/user | Cases/run | Total |
|--------|-------|-----------|-----------|-------|
| 1 | 6 | 5 | 9 | **270** |
| 2 | 6 | 5 | 9 | **270** |
| 3 | 6 | 5 | 9 | **270** |
| **Target** | — | — | — | **810** |

Minimum acceptable (documented infra issue only): **540** cases (2 full windows).

Each run includes **`final_tagged_plan`**. Sparse corpus scored honestly with failure class documented.

---

## 5. Gate table

| Gate | Target | Hard threshold |
|------|--------|----------------|
| HTTP 200 | **100%** | **100%** |
| Fallback rate | **0%** | **≤1%** |
| `final_tagged_plan` fallback | **0** | **0** (all users/windows) |
| Avg quality score | **≥4.0** | **≥3.5** |
| Worst quality score | **≥3.0** | **≥3.0** |
| Hybrid p95 | — | **≤3000 ms** |
| Canary errors | **0** | **0** |
| Telemetry WARNs | **0** | **0** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Contracts | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| Anchored overlap | **16/16** | **≥10/16** |
| Pure overlap | report-only | no promotion |
| True zero-results | **0** | **0** |
| Embed timeouts | **0** | **0** |
| Rollback drill | **PASS** | **PASS** |

---

## 6. Stop rule

If **any hard gate fails** during T20.19C:

1. Restore single contract-user KEEP env immediately
2. Write **failure** doc
3. **Stop** before T20.19D/E
4. Do not hide failure

---

## 7. Evidence baseline

| Batch | Cases | HTTP 200 | Fallback | Users |
|-------|-------|----------|----------|-------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 |
| T20.18C-LIVE | 270 | 270/270 | 0% | 6 |
| **Prior combined** | **405** | **405/405** | **0%** | — |
| **T20.19C target** | **810** | 100% | 0% target | 6 |

---

## 8. Final env expectation

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
image: python-ai-service:t20-p216b
```

---

## 9. Ticket sequence

| Ticket | Scope |
|--------|-------|
| T20.19A | This design |
| T20.19B | Preflight + controls |
| T20.19C-LIVE | 3-window live soak |
| T20.19D | Decision package |
| T20.19E | Closeout + `PHASE_21_COPILOT_CONTEXT.md` |

Do **not** start T20.20A until T20.19E closeout is complete.
