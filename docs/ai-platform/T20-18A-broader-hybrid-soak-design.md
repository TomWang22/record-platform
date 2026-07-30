# T20.18A — Broader hybrid soak design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `409bfb8` (T20.17E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.17D decision (B selected; C recommended → this broader soak)

---

## 1. Executive verdict

```text
T20.18A broader hybrid soak design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Multi-user live soak: NOT STARTED (T20.18B preflight → T20.18C)
```

T20.17 proved **90/90** live cases on one allowlisted contract user. T20.18 broadens evidence by running real JWT-authenticated hybrid inference across **multiple scoped allowlisted users** while keeping `PERCENT=0`.

---

## 2. Objective

Collect **multi-user scoped allowlist evidence** with **PERCENT=0**:

- Temporarily broaden `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST` to verified cohort UUIDs (dev/staging only)
- **5×** 9-case transcript per authenticated user (target 6 users → **270** cases; minimum 3 users → **135** cases)
- Re-verify `final_tagged_plan` per user
- Restore **single contract-user allowlist** after eval unless decision explicitly selects broader KEEP

---

## 3. User cohort plan

| # | Email | UUID | Role |
|---|-------|------|------|
| 1 | e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | Primary contract / seller corpus |
| 2 | t20-15g-cohort0@record-platform.local | `00000040-0000-4000-8000-000000000000` | Percent bucket 0 cohort |
| 3 | t20-15k-cohort1@record-platform.local | `0000002a-0000-4000-8000-000000000000` | Percent bucket 1 cohort |
| 4 | buyer-contract@record-platform.local | `5a68fe88-c134-4166-b145-57534a3656b9` | Buyer / bucket 9 control |
| 5 | t20-15o-bucket10@record-platform.local | `000001bc-0000-4000-8000-000000000000` | Bucket 10 cohort |
| 6 | t20-15s-bucket20@record-platform.local | `00000002-0000-4000-8000-000000000000` | Bucket 20 cohort |

Auth: JWT login (`ContractPass123!` per T20.15 cohort pattern). JWT `sub` must match expected UUID — **no header spoofing** (request user_id must equal JWT sub).

Users that fail login are documented; eval continues with ≥3 authenticated users.

---

## 4. Lanes

### Lane C — keyword production default

Fake allowlist + `CANARY=0` controls; record/longform Playwright under Lane C.

### Lane B — hybrid anchored allowlist canary

Temporary multi-user allowlist; PERCENT=0; primary live transcript path.

### Lane A — pure vector report-only

Shadow supplementary — separate from anchored gate.

---

## 5. Eval matrix

| Path | Env | Expected (allowlisted user) | Expected (non-allowlisted) |
|------|-----|----------------------------|---------------------------|
| Multi-user allowlist | Broad UUID list, PERCENT=0 | `hybrid_canary` / `allowlist` | N/A (all cohort in list) |
| Original KEEP | Contract UUID only | contract → hybrid | others → keyword |
| Fake allowlist | `00000000-…` | all → `keyword` / `keyword_default` |
| CANARY=0 rollback | `AI_RAG_HYBRID_CANARY=0` | all → `keyword` |

### Live transcript

- Per user: **5×** `rp-ai-hybrid-canary-transcript.sh` with `AI_CONTRACT_EMAIL` + `CONTRACT_USER_ID` (= JWT sub)
- Includes **`final_tagged_plan`** every run
- Sparse corpus: score honestly; document sparsity vs retrieval vs synthesis failures

### Shadow

- **3×** `rp-ai-shadow-real-query-timing.sh`
- **1×** `rp-ai-shadow-source-diagnostic.sh` (classify; non-blocking if known OBO class)

### Playwright

| Suite | Env |
|-------|-----|
| seller-intelligence | Broader allowlist during eval (documented) |
| record RAG | Lane C fake allowlist |
| longform RAG | Lane C fake allowlist |

---

## 6. Gates

| Gate | Target | Hard threshold |
|------|--------|----------------|
| HTTP 200 (aggregate) | **100%** | **100%** |
| Fallback rate | **0%** | **≤2%** |
| `final_tagged_plan` fallback | **0** per user | **0** |
| Avg quality score | **≥4.0** | **≥3.5** |
| Worst quality score | **≥3.0** | **≥3.0** |
| Hybrid p95 | — | **≤3000 ms** |
| Canary errors | **0** | **0** |
| Telemetry WARNs | **0** | **0** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Anchored overlap | **16/16** | **≥10/16** |
| Pure overlap | report-only | no promotion |
| True zero-results | **0** | **0** |
| Embed timeouts | **0** | **0** |
| Playwright | **PASS** | **PASS** |
| Rollback drill | **PASS** | **PASS** |
| Authenticated users | **6** target | **≥3** minimum |

---

## 7. Stop rule

If **any hard gate fails** during T20.18C:

1. Restore original single contract-user KEEP env immediately
2. Write **failure** doc
3. **Stop** before T20.18D/E
4. Do not hide failure

---

## 8. Final env expectation

Default after closeout (unless D selects C with justification):

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
image: python-ai-service:t20-p216b
```

---

## 9. Evidence baseline

| Batch | Cases | HTTP 200 | Fallback | Users |
|-------|-------|----------|----------|-------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 |
| **T20.18C target** | **270** | 100% | 0% target | **6** |

---

## 10. Ticket sequence

| Ticket | Scope |
|--------|-------|
| **T20.18A** | This design |
| **T20.18B** | Preflight + cohort JWT verification + controls |
| **T20.18C-LIVE** | Multi-user live soak |
| **T20.18D** | Decision (B vs C) |
| **T20.18E** | Closeout + `PHASE_21_COPILOT_CONTEXT.md` |

Do **not** start T20.19A until T20.18E closeout is complete.
