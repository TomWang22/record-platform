# T20.32B — Broader opt-in hybrid preview readiness preflight

**Status:** **PASS**  
**Generated:** 2026-07-02  
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

## 3. Context checks

| Check | Result |
|-------|--------|
| Cumulative live (D16→T20.31C) | **16065/16065** reflected |
| T20.32A authorized (not stale T20.31 NOT STARTED) | **PASS** |
| Same 12 JWT participants | **PASS** |
| Allowlist not broadened | **PASS** |

## 4. Preflight controls

| Control | Result |
|---------|--------|
| Guest: preview card hidden | **PASS** (Playwright) |
| Contract: `allowlist` | **PASS** |
| Non-enrolled participants: `keyword_default` | **PASS** |
| UI enroll smoke | **PASS** |
| UI revoke smoke | **PASS** |
| API enroll/revoke consistency | **PASS** |
| PERCENT=0 | **PASS** |
| Active enrollments after preflight | **revoked** |

## 5. Verdict

```text
T20.32B: PASS
T20.32C-LIVE: AUTHORIZED (8640 cases, 16 windows, 12 participants)
```
