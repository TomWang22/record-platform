# Owner/product sign-off — opt-in hybrid preview implementation

**Approver name:** Tom Wang / repository owner  
**Approver role:** Owner / Product  
**Date (UTC):** 2026-07-01  
**Baseline SHA:** a90e008  
**Scope:** Opt-in hybrid preview implementation only (T20.25A-H)

## Explicitly approved

- [x] Opt-in hybrid preview implementation only (API-only, no UI)
- [x] Non-default preview enrollment (owner self-opt-in, JWT only)
- [x] Owner/user scoped enrollment only
- [x] Keyword default unchanged for non-enrolled users
- [x] AI_RAG_HYBRID_CANARY_PERCENT remains 0
- [x] AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT remains 0
- [x] Hybrid anchored Lane B only
- [x] Keyword fallback retained
- [x] Overlap anchors retained
- [x] Rollback runbook accepted (T20.24D / T20.25E)
- [x] Live eval required before preview decision
- [x] Revoke/rollback drill required before closeout

## Explicitly NOT approved

- [x] Hybrid production default
- [x] Vector production default
- [x] PERCENT > 0
- [x] Percentage rollout
- [x] Broadened permanent allowlist
- [x] UI preview toggle
- [x] Message-body exposure
- [x] Anonymous or guest hybrid access
- [x] Removal of keyword fallback
- [x] Removal of overlap anchors

## Evidence acknowledged

- Combined live 2025/2025 HTTP 200, 0% fallback
- `final_tagged_plan` fallback 0 through T20.21B
- Pure vector 8/16 report-only
- Anchored hybrid 16/16
- Telemetry WARNs 0
- Leakage / OCH PASS

## Approval reference

Owner instruction pasted into Cursor:

> I approve the opt-in hybrid preview implementation scope described in T20.24A §8. Create the sign-off artifact first, then run T20.25A-H end-to-end.

**Signature / approval reference:** owner chat instruction recorded in this repo artifact.
