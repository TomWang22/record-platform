# T20.25A — Opt-in hybrid preview sign-off verification

**Status:** **COMPLETE** — owner/product sign-off verified  
**Generated:** 2026-07-01  
**Baseline SHA:** `a90e008` (pre-sign-off block)  
**Sign-off commit SHA:** `d0e8930`  
**Current SHA (post verification):** pending commit A  
**Image:** `python-ai-service:t20-p216b` (unchanged until T20.25B deploy)

---

## 1. Sign-off artifact

| Field | Value |
|-------|-------|
| Path | `docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md` |
| Approver name | Tom Wang / repository owner |
| Approver role | Owner / Product |
| Date (UTC) | 2026-07-01 |
| Baseline SHA | `a90e008` |
| Approval reference | Owner chat instruction recorded in artifact |

## 2. Approved scope (verified)

- Opt-in hybrid preview implementation only (API-only, no UI)
- Non-default preview enrollment (owner self-opt-in, JWT only)
- Owner/user scoped enrollment only
- Keyword default unchanged for non-enrolled users
- `AI_RAG_HYBRID_CANARY_PERCENT` remains 0
- `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` remains 0
- Hybrid anchored Lane B only; keyword fallback and overlap anchors retained
- Rollback runbook accepted (T20.24D / T20.25E)
- Live eval and revoke/rollback drill required before closeout

## 3. Explicitly NOT approved (verified)

- Hybrid production default
- Vector production default
- PERCENT > 0 / percentage rollout
- Broadened permanent allowlist
- UI preview toggle
- Message-body exposure
- Anonymous or guest hybrid access
- Removal of keyword fallback or overlap anchors

## 4. Evidence acknowledged

- Combined live 2025/2025 HTTP 200, 0% fallback
- `final_tagged_plan` fallback 0 through T20.21B
- Pure vector 8/16 report-only; anchored hybrid 16/16
- Telemetry WARNs 0; leakage / OCH PASS

## 5. Verdict

```text
Sign-off: COMPLETE
T20.25B: AUTHORIZED
```

This is **not** agent self-sign-off. Approval is recorded from the committed owner artifact citing the owner chat instruction.
