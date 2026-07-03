# T20.35B — Real-participant artifact audit and preflight

**Status:** Preflight **PASS**; artifact audit **BLOCKED** (incomplete rows)  
**Generated:** 2026-07-03  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`

---

## 1. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 2. Env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## 3. Participant artifact audit

| Check | Result |
|-------|--------|
| `T20-35-owner-approved-real-preview-participants.md` | **PRESENT** (committed) |
| Artifact status | **INCOMPLETE** — template with TBD placeholders |
| Complete `real_owner_approved` count | **0** (minimum: **3**) |
| Rows with valid email | **0** (all `TBD`) |
| Rows with valid UUID/JWT sub | **0** (all `TBD`) |
| Approval source | **TBD** (all rows) |
| Consent confirmed | **yes/no** (unset — not confirmed) |
| Signature / approval reference | **TBD** |
| JWT sub match verification | **N/A** — no complete UUIDs |
| Staging 12-JWT cohort | **Not used** |

### Missing fields (all 3 rows)

- Email, UUID/JWT sub, approval source, consent confirmation, owner approval reference, signature

## 4. Runtime controls (preflight smoke)

| Control | Result |
|---------|--------|
| Guest: preview hidden | **PASS** (Playwright 4/4) |
| Contract: `allowlist` | **PASS** |
| Non-enrolled: `keyword_default` | **PASS** |
| UI enroll/revoke smoke | **PASS** |
| API enroll/revoke consistency | **PASS** |
| PERCENT=0 | **PASS** |
| Message-body exposure | **0** |
| Cumulative staging live | **24705/24705** (unchanged) |

## 5. Verdict

```text
T20.35B: PASS (preflight + controls); artifact audit BLOCKED
T20.35C-LIVE: BLOCKED — complete ≥3 participant rows in artifact first
T20.35C-BLOCKED: AUTHORIZED
```
