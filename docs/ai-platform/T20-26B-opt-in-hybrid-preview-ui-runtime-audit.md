# T20.26B — Opt-in hybrid preview UI runtime audit

**Status:** Runtime/API audit **PASS**  
**Generated:** 2026-07-01  
**Baseline SHA:** `50bc1f3` (T20.26A)  
**Image:** `python-ai-service:t20-p225b` (unchanged)

---

## 1. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 2. JWT runtime smoke (no header spoofing)

### 2.1 Contract user (`e2e-contract@record-platform.local`)

| Check | Result |
|-------|--------|
| `GET /preview/status` | not enrolled (`gate_reason: keyword_default`) |
| RAG query | `hybrid_canary` / `allowlist` |
| Allowlist priority | **PASS** — preview status does not override allowlist |

### 2.2 Cohort user before enroll (`t20-15g-cohort0@record-platform.local`)

| Check | Result |
|-------|--------|
| `GET /preview/status` | not enrolled |
| RAG query | `keyword` / `keyword_default` |

### 2.3 Cohort enroll

| Check | Result |
|-------|--------|
| `POST /preview/enroll` | HTTP 200, `enrolled: true` |
| `GET /preview/status` | enrolled, `gate_reason: preview_opt_in` |
| RAG query | `hybrid_canary` / `preview_opt_in` |

### 2.4 Cohort revoke

| Check | Result |
|-------|--------|
| `POST /preview/revoke` | HTTP 200, `revoked: true` |
| `GET /preview/status` | not enrolled |
| RAG query | `keyword` / `keyword_default` |

## 3. Env verification

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

| Check | Result |
|-------|--------|
| PERCENT=0 | **PASS** |
| ALLOW_PROD_PERCENT=0 | **PASS** |
| Allowlist not broadened | **PASS** |
| Active enrollments after audit | **0** (revoked) |
| Telemetry WARNs | **0** |
| RP | **PASS** |

## 4. Verdict

```text
T20.26B: PASS
T20.26C-LIVE: AUTHORIZED
```

API-only preview runtime is ready for the UI design in T20.26A. No UI code changed.
