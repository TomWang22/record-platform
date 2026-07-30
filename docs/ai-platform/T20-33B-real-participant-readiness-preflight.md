# T20.33B — Real-participant readiness preflight and artifact audit

**Status:** Preflight **PASS**; real-participant live eval **BLOCKED**  
**Generated:** 2026-07-02  
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
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
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
| `docs/ai-platform/T20-33-owner-approved-real-preview-participants.md` | **ABSENT** |
| Owner-provided UUIDs in repo | **NONE** |
| `real_owner_approved` count | **0** |
| Staging 12-JWT cohort (T20.29–T20.32) | Present — **staging_cohort only**; not eligible for real-participant C-LIVE |

**Decision after B:** Real-participant live eval is **BLOCKED**. Do not relabel staging JWT accounts as real participants.

## 4. Runtime controls (staging smoke — not real-participant eval)

| Control | Result |
|---------|--------|
| Guest: preview hidden | **PASS** (Playwright) |
| Contract: `allowlist` | **PASS** |
| Non-enrolled: `keyword_default` | **PASS** |
| UI enroll/revoke smoke | **PASS** |
| API enroll/revoke consistency | **PASS** |
| PERCENT=0 | **PASS** |
| Active enrollments | **revoked** |
| Cumulative staging live | **24705/24705** (unchanged) |

## 5. Verdict

```text
T20.33B: PASS (preflight + controls)
T20.33C-LIVE: BLOCKED — missing owner-approved participant artifact
T20.33C-BLOCKED: AUTHORIZED
```
