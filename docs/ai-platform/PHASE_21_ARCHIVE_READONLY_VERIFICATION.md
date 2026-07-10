# Phase 21 archive read-only verification

**Verified:** 2026-07-04  
**Script:** `scripts/verify-phase-21-archive-readonly.sh`  
**Transport smoke:** `scripts/smoke-ai-rag-transport-protocols-readonly.sh`

## Result

```text
Phase 21 archive read-only verification: PASS
Archive HEAD: 1422152
Pre-archive validation HEAD: 2eb1606
Current HEAD at verification: 14221520b764f8ac6bd7001db7071fcf74ab9e61 (archive checkpoint; handoff commit d27ebcd)
Artifact SHA256: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
T20.42A–G: CLOSED PASS
T20.42C-LIVE: PASS 4320/4320
Cumulative live matrix: 57105/57105 HTTP 200, 0% fallback
Important: cumulative live matrix was produced by the existing live runners over HTTP/1.1. HTTP/2 and HTTP/3 are covered by separate transport smoke evidence, not included in 57105.
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Permanent allowlist: contract user only
Hybrid/vector production default: NOT APPROVED
Runtime/env changes: NONE
Live eval run: NO
```

## Protocol transport smoke (read-only, single-query real inference)

Executed against contract allowlist RAG path (`e2e-contract@record-platform.local`, user `2ed75568-7deb-4c29-91b0-6919f24a0c9f`).

| Protocol | Login | RAG query | Negotiated version | Gate                      | Fallback |
| -------- | ----- | --------- | ------------------ | ------------------------- | -------- |
| HTTP/1.1 | 200   | 200       | 1.1                | hybrid_canary / allowlist | 0        |
| HTTP/2   | 200   | 200       | 2                  | hybrid_canary / allowlist | 0        |
| HTTP/3   | 200   | 200       | 3                  | hybrid_canary / allowlist | 0        |

```text
This protocol smoke is read-only, single-query real inference evidence. It does not modify the cumulative live count.
```

## Re-run (read-only)

```bash
bash scripts/verify-phase-21-archive-readonly.sh

CONTRACT_PASSWORD='...' \
BASE_URL='https://record-platform.test' \
CA_CERT='certs/dev-chain.pem' \
bash scripts/smoke-ai-rag-transport-protocols-readonly.sh
```

Expected archive verification: `PASS: Phase 21 archive read-only verification`

Expected transport smoke:

```text
h1-explicit login=200 rag=200|1.1 gate=hybrid_canary/allowlist fallback=0
h2 login=200 rag=200|2 gate=hybrid_canary/allowlist fallback=0
h3 login=200 rag=200|3 gate=hybrid_canary/allowlist fallback=0
PASS: HTTP/1.1, HTTP/2, and HTTP/3 RAG transport smoke
```
