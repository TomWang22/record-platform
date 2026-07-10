# T20.21A — Hybrid default RFC / owner sign-off design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `ab32bb0` (T20.20E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.20D decision (B selected; D recommended → this RFC/sign-off batch)

---

## 1. Executive verdict

```text
T20.21A hybrid default RFC / owner sign-off design: COMPLETE
No rollout approval
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user operationally)
AI_RAG_HYBRID_CANARY_PERCENT=0
Final live confirmation: NOT STARTED (T20.21B → T20.21C)
```

This batch converts T20.15–T20.20 evidence into a formal **RFC and owner sign-off packet**. It is **not** authorization to switch production default.

---

## 2. Evidence baseline

| Batch | Cases | HTTP 200 | Fallback | Notes |
|-------|-------|----------|----------|-------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 user |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 user |
| T20.18C-LIVE | 270 | 270/270 | 0% | 6 JWT users |
| T20.19C-LIVE | 810 | 810/810 | 0% | 3 windows |
| T20.20C-LIVE | 540 | 540/540 | 0% | 2 windows |
| **Combined prior** | **1755** | **1755/1755** | **0%** | — |
| **T20.21B target** | **270** | 100% | 0% target | 1 confirmation window |

Shadow diagnostics (stable): pure overlap **8/16** report-only; anchored hybrid **16/16**.

---

## 3. RFC question

**Should hybrid anchored retrieval become a future production default candidate?**

Answer cannot be **yes** unless:

1. All default-switch blockers are explicitly resolved or accepted with documented mitigation
2. Owner/product sign-off is **present** and recorded
3. Engineering, privacy, ops rollback, and observability sign-offs are **present**
4. A scoped rollout design (T20.22A+) is approved separately — not implied by this RFC

Current evidence supports **continued allowlist canary at percent=0**, not default switch.

---

## 4. RFC lane definitions

| Lane | Name | Role |
|------|------|------|
| **C** | Keyword / rule-engine | **Production default** — all non-allowlisted users |
| **B** | Hybrid anchored | **Allowlist canary** — evidence collection only |
| **A** | Pure vector | **Report-only** — shadow diagnostics, not promotion-ready |

---

## 5. Default-switch blockers

| Blocker | Status |
|---------|--------|
| Pure vector 8/16 | **Open** — report-only |
| Hybrid depends on keyword anchors | **Open** — cannot drop keyword path |
| Keyword fallback mandatory | **Required** — must stay enabled |
| No broad real production cohort sign-off | **Open** |
| No owner/product sign-off | **Open** (expected absent in this batch) |
| Production default currently keyword | **Current** — unchanged |

---

## 6. Sign-off checklist

| Item | Required for default switch | T20.21A status |
|------|----------------------------|----------------|
| Owner/product approval | Yes | **Not in scope** — design only |
| Engineering approval | Yes | **Not in scope** |
| Privacy/leakage approval | Yes | Evidence PASS; formal sign-off absent |
| Rollback approval | Yes | Runbook documented; formal sign-off absent |
| Observability approval | Yes | Telemetry 0 WARNs; formal sign-off absent |
| Support/ops approval | Yes | **Not in scope** |

---

## 7. Cohort (6 JWT users)

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

## 8. Final confirmation plan (T20.21B)

| Users | Runs/user | Cases/run | Total |
|-------|-----------|-----------|-------|
| 6 | 5 | 9 | **270** |

- **PERCENT=0** throughout
- Temporary 6-user allowlist during eval only
- Restore **single contract-user allowlist** after eval
- Embed warmup before live transcript

---

## 9. Decision gates (T20.21B)

| Gate | Target | Hard threshold |
|------|--------|----------------|
| HTTP 200 | **270/270** | **100%** |
| Fallback rate | **0%** | **≤1%** |
| `final_tagged_plan` fallback | **0** | **0** |
| Avg quality score | **≥4.0** | **≥3.5** |
| Worst quality score | **≥3.0** | **≥3.0** |
| Hybrid p95 | — | **≤3000 ms** |
| Canary errors | **0** | **0** |
| Telemetry WARNs | **0** | **0** |
| Leakage / OCH / contracts / Playwright | **PASS** | **PASS** |
| Anchored overlap | **16/16** | **≥10/16** |
| Pure overlap | report-only | no promotion |
| True zero-results / embed timeouts | **0** | **0** |
| Rollback drill | **PASS** | **PASS** |

---

## 10. Stop rule

If **any hard gate fails** during T20.21B:

1. Restore single contract-user KEEP env immediately
2. Write **failure** status in B doc
3. **Stop** before T20.21C/D/E
4. Do not hide failure

---

## 11. Decision options (T20.21C)

| Option | Description |
|--------|-------------|
| **A** | Rollback hybrid canary entirely |
| **B** | KEEP single-user allowlist canary, percent=0 |
| **C** | KEEP broader dev/staging allowlist, percent=0 |
| **D** | Recommend T20.22A production-rollout **design only** if explicit owner sign-off exists |
| **E** | Approve default switch now — **REJECTED** unless explicit sign-off and blockers resolved |

**Expected:** Select **B**; reject **E**; **D** design-only only if sign-off path ready.

---

## 12. Ticket sequence

| Ticket | Scope |
|--------|-------|
| T20.21A | This design |
| T20.21B | Preflight + 270-case live confirmation |
| T20.21C | RFC / owner sign-off decision package |
| T20.21D | RFC closeout |
| T20.21E | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

Do **not** start T20.22A until T20.21E closeout is complete.
