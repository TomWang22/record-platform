# T20.35B-REBLOCKED — Real-participant artifact re-audit

**Status:** Artifact audit **REBLOCKED**; preflight **PASS**  
**Generated:** 2026-07-03  
**Prior main SHA:** `c66f2b1`  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`

---

## 1. Trigger

Owner-approved re-run of T20.35B artifact audit per post-closeout authorization. Artifact path unchanged; participant rows not yet completed by owner.

## 2. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 3. Preview UI smoke (preflight control)

`e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts`: **4/4 PASS**

## 4. Artifact audit

| Check | Result |
|-------|--------|
| Artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Artifact modified since T20.35H | **NO** |
| Complete participant rows | **0** / **3** required |
| JWT sub verification | **N/A** — no complete UUIDs |

### Per-row failures (all 3 rows)

| # | Email | UUID | Approval source | Consent | Signature |
|---|-------|------|-----------------|---------|-----------|
| 1 | TBD | TBD | TBD | yes/no (unset) | TBD |
| 2 | TBD | TBD | TBD | yes/no (unset) | TBD |
| 3 | TBD | TBD | TBD | yes/no (unset) | TBD |

### Field gate checklist (0 rows pass)

1. Real email — **FAIL** (TBD)
2. Verified UUID/JWT sub — **FAIL** (TBD)
3. Participant type `real_owner_approved` or `internal_staff` — type set but row incomplete
4. Approval source — **FAIL** (TBD)
5. Consent confirmed: yes — **FAIL** (yes/no placeholder)
6. Scope opt-in preview soak only — **PASS** (static column)
7. Message bodies exposed?: NO — **PASS**
8. Production default approved?: NO — **PASS**
9. PERCENT > 0 approved?: NO — **PASS**
10. Signature / approval reference — **FAIL** (TBD)
11. JWT login + sub match — **NOT RUN** (no UUIDs)

## 5. Runtime controls (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Staging 12-JWT cohort: **not used** as real-participant substitute.

## 6. Verdict

```text
T20.35B-REBLOCKED: artifact still incomplete (0/3)
T20.35C-LIVE: NOT AUTHORIZED — STOP before live eval
T20.35D–H: NO UPDATE (prior CLOSED/BLOCKED closeout stands)
Cumulative staging live: 24705/24705 (unchanged)
```

## 7. Owner action required

Complete all 3 participant rows with real email, verified JWT sub, approval source, consent=yes, and signature; commit artifact; re-run this audit.
