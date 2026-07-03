# T20.34B — Owner-approved participant artifact audit

**Status:** Preflight **PASS**; owner-approved participant soak **BLOCKED**  
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
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
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
| `docs/ai-platform/T20-34-owner-approved-real-preview-participants.md` | **ABSENT** |
| `docs/ai-platform/T20-33-owner-approved-real-preview-participants.md` | **ABSENT** |
| `real_owner_approved` count | **0** |
| `internal_staff` (owner-approved) | **0** |
| JWT sub verification | **N/A** — no artifact rows |
| Staging 12-JWT cohort | Present — **not eligible** for T20.34C-LIVE |

**Missing fields:** entire artifact (email, UUID, type, approval source, consent, all explicit NOs).

## 4. Runtime controls (preflight smoke — not soak)

| Control | Result |
|---------|--------|
| Guest: preview hidden | **PASS** (Playwright 4/4) |
| Contract: `allowlist` | **PASS** |
| Non-enrolled: `keyword_default` | **PASS** |
| UI enroll/revoke smoke | **PASS** |
| API enroll/revoke consistency | **PASS** |
| PERCENT=0 | **PASS** |
| Active enrollments | **revoked** |
| Message-body exposure | **0** |
| Cumulative staging live | **24705/24705** (unchanged) |

## 5. Verdict

```text
T20.34B: PASS (preflight + controls)
T20.34C-LIVE: BLOCKED — commit participant artifact first
T20.34C-BLOCKED: AUTHORIZED
```
