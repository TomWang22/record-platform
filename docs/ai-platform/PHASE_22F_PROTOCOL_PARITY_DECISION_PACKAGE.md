# Phase 22F — protocol parity decision package

**Status:** COMPLETE  
**Decision:** **C — KEEP** (no production-default or rollout change)

---

## Options

| Option | Description | Recommendation |
| ------ | ----------- | -------------- |
| A | Switch hybrid/vector production default | **REJECTED** |
| B | Enable PERCENT / ALLOW_PROD_PERCENT rollout | **REJECTED** |
| C | **KEEP** keyword default + opt-in preview + contract allowlist at PERCENT=0 | **SELECTED** |

---

## Rationale

Phase 22C protocol-parity live matrix **7200/7200 PASS** across HTTP/1.1, HTTP/2, and HTTP/3 with:

- 0% fallback
- 100% response/sentiment/red-team pass
- 0 leakage failures
- Correct gate counts (6000 preview_opt_in, 1200 allowlist)
- Post-revoke keyword restore PASS (Phase 22D)

This validates **protocol parity for real inference** but does **not** authorize production-default switch or percentage rollout.

---

## Locked state (unchanged)

```text
Production default: keyword
Preview UI/API: KEEP
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

---

## Labeled evidence

```text
Phase 21 HTTP/1.1 cumulative matrix: 57105/57105
Phase 22C protocol-parity matrix: 7200/7200 (H1/H2/H3)
```

Do not merge without labels.
