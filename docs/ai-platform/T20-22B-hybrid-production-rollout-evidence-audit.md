# T20.22B — Hybrid production rollout evidence audit

**Status:** Audit complete — **PASS**  
**Generated:** 2026-07-01  
**Plan SHA:** `95f1cfb` (T20.22A)  
**Image:** `python-ai-service:t20-p216b`  
**Mode:** Audit-only — **no new live inference**

---

## 1. Git status (pre-commit)

Only intended docs committed per ticket; `bench_logs/`, screenshots, and scratch scripts remain untracked.

---

## 2. Closeout doc inventory

| Doc | Status |
|-----|--------|
| `T20-15AG-hybrid-canary-ladder-closeout.md` | **Present** |
| `T20-16F-hybrid-production-readiness-closeout.md` | **Present** |
| `T20-17E-scoped-hybrid-soak-closeout.md` | **Present** |
| `T20-18E-broader-hybrid-soak-closeout.md` | **Present** |
| `T20-19E-extended-hybrid-soak-closeout.md` | **Present** |
| `T20-20E-hybrid-production-decision-closeout.md` | **Present** |
| `T20-21D-hybrid-default-rfc-closeout.md` | **Present** |
| T20.21E context reconciliation | **Present** (`7689d25` — `PHASE_21_COPILOT_CONTEXT.md`) |

---

## 3. Context audit (`PHASE_21_COPILOT_CONTEXT.md`)

| Check | Result |
|-------|--------|
| Reflects T20.21 closeout | **Yes** (T20.21A–D CLOSED) |
| Current image `t20-p216b` | **Yes** |
| Stale `t20-p215f` as current image | **Not present** |
| Stale `T20.21A NOT STARTED` in locked takeaway | **Not present** (shows T20.22A NOT STARTED — pre-T20.22E) |
| Combined live **2025/2025** | **Present** in locked takeaway |
| Stale combined live 1755-only in locked takeaway | **Not present** (1755 appears only in historical T20.20 line) |

---

## 4. Cluster / env snapshot

| Check | Result |
|-------|--------|
| Image | `python-ai-service:t20-p216b` |
| Pod | **Running** 1/1 |
| `AI_RAG_HYBRID_CANARY` | **1** |
| `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST` | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` **only** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** |

---

## 5. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## 6. Control verification (no env change)

| User | Mode | gate_reason | Result |
|------|------|-------------|--------|
| contract | hybrid_canary | allowlist | **PASS** |
| cohort (t20-15g-cohort0) | keyword | keyword_default | **PASS** |
| `PERCENT=0` | — | — | **Verified** |

---

## 7. Evidence totals

| Metric | Value |
|--------|-------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored overlap | **16/16** |
| Pure overlap | **8/16** report-only |

---

## 8. Sign-off inventory

| Sign-off | Status |
|----------|--------|
| Owner/product sign-off | **ABSENT** |
| Engineering sign-off | **ABSENT** |
| Privacy/leakage sign-off | Evidence **PASS**; formal sign-off **ABSENT** |
| Ops/rollback sign-off | Runbook documented; formal sign-off **ABSENT** |
| Observability sign-off | Telemetry 0 WARNs; formal sign-off **ABSENT** |
| Support/comms sign-off | **ABSENT** |

**Decision rule:** Owner/product sign-off absent → T20.22C must **reject rollout approval**.

---

## 9. Gate verdict — **PASS**

Audit gates pass. No new live inference required (no audit mismatch). Proceed to **T20.22C** rollout decision package.

Rollout implementation remains **NOT APPROVED**.
