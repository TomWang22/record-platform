# T20.29B — Participant-limited opt-in hybrid preview preflight

**Status:** **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b` (unchanged)

---

## 1. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=589`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 2. Env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## 3. Participant inventory (12 JWT users)

| Email | JWT sub match | Role | Pre-enroll RAG |
|-------|---------------|------|----------------|
| e2e-contract@record-platform.local | **OK** | allowlist | `hybrid_canary` / `allowlist` |
| t20-15g-cohort0@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15k-cohort1@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| buyer-contract@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15o-bucket10@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15s-bucket20@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| seller-contract@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| bidder2-contract@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| bidder3-contract@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15s-bucket25@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15w-bucket30@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |
| t20-15w-bucket50@record-platform.local | **OK** | participant | `keyword` / `keyword_default` |

No additional owner-approved accounts beyond this 12-user set were provisioned. Allowlist not broadened.

## 4. Preflight controls

| Control | Result |
|---------|--------|
| Guest: no preview card | **PASS** (Playwright) |
| Contract: `allowlist` | **PASS** |
| Non-enrolled participant: `keyword_default` | **PASS** |
| UI enroll participant | **PASS** (Playwright) |
| UI revoke participant | **PASS** (Playwright) |
| PERCENT=0 | **PASS** |
| Active enrollments after preflight | **revoked** |

## 5. Verdict

```text
T20.29B: PASS
T20.29C-LIVE: AUTHORIZED (2160 cases, 12 participants)
```
