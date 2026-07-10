# T20.20A — Hybrid production-decision design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `9bf192c` (T20.19E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.19D decision (B selected; D recommended → this production-decision package)

---

## 1. Executive verdict

```text
T20.20A hybrid production-decision design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user operationally)
AI_RAG_HYBRID_CANARY_PERCENT=0
Final live verification: NOT STARTED (T20.20B → T20.20C)
```

T20.19 accumulated **1215/1215** live cases with 0% fallback across four soak batches. T20.20 converts that evidence into a **formal production-decision package** with one final **540-case** live verification pass — still **not** rollout approval.

---

## 2. Evidence baseline

| Batch | Cases | HTTP 200 | Fallback | Notes |
|-------|-------|----------|----------|-------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 user |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 user |
| T20.18C-LIVE | 270 | 270/270 | 0% | 6 JWT users |
| T20.19C-LIVE | 810 | 810/810 | 0% | 3 windows |
| **Combined prior** | **1215** | **1215/1215** | **0%** | — |

---

## 3. Current operational state

```text
image: python-ai-service:t20-p216b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
production default: keyword
vector production default: NOT APPROVED
```

---

## 4. Decision problem

| Factor | Assessment |
|--------|------------|
| Hybrid anchored canary | **Strong** — 1215/1215 live, 0% fallback, hybrid p95 ~119 ms (T20.19C) |
| Pure vector overlap | **8/16 report-only** — not promotion-ready |
| Hybrid anchor dependency | Hybrid requires keyword anchors; cannot drop keyword fallback |
| Production default switch | **Not automatically authorized** by canary soak evidence alone |
| Owner/product decision | No documented owner sign-off to switch default |

Canary evidence supports **continued allowlist canary** at percent=0. It does **not** authorize vector or hybrid as production default without explicit owner decision and blocker resolution.

---

## 5. Cohort (6 JWT users)

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

## 6. Final verification plan (T20.20C)

| Window | Users | Runs/user | Cases/run | Total |
|--------|-------|-----------|-----------|-------|
| 1 | 6 | 5 | 9 | **270** |
| 2 | 6 | 5 | 9 | **270** |
| **Target** | — | — | — | **540** |

Minimum acceptable (documented infra issue only): **270** cases (1 full window).

Temporary 6-user allowlist during eval only. Restore single contract-user allowlist after eval unless T20.20D explicitly selects broader KEEP.

---

## 7. Decision gates

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
| OCH | **PASS** | **PASS** |
| Contracts | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| Anchored overlap | **16/16** | **≥10/16** |
| Pure overlap | report-only | no promotion |
| True zero-results | **0** | **0** |
| Embed timeouts | **0** | **0** |
| Rollback drill | **PASS** | **PASS** |

---

## 8. Stop rule

If **any hard gate fails** during T20.20C:

1. Restore single contract-user KEEP env immediately
2. Write **failure** doc
3. **Stop** before T20.20D/E
4. Do not hide failure

---

## 9. Decision options (T20.20D)

| Option | Description |
|--------|-------------|
| **A** | Rollback hybrid canary entirely |
| **B** | KEEP single-user allowlist canary, percent=0 |
| **C** | KEEP broader dev/staging allowlist, percent=0 |
| **D** | Recommend T20.21A hybrid default RFC / owner sign-off design only |
| **E** | Approve production default switch — **must be REJECTED** unless owner-approved and blockers resolved |

**Expected:** Select **B** unless clear operational reason for **C**. Recommend **D** if T20.20C clean. Reject **E**.

---

## 10. Final env expectation

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
image: python-ai-service:t20-p216b
production default: keyword
vector production default: NOT APPROVED
```

---

## 11. Ticket sequence

| Ticket | Scope |
|--------|-------|
| T20.20A | This design |
| T20.20B | Preflight + evidence audit |
| T20.20C-LIVE | Final 540-case verification |
| T20.20D | Formal production-decision package |
| T20.20E | Closeout + `PHASE_21_COPILOT_CONTEXT.md` |

Do **not** start T20.21A until T20.20E closeout is complete.
