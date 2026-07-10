# T20.15D-T — Hybrid canary control and rollback drill

**Status:** Drill complete  
**Generated:** 2026-06-29  
**SHA:** `d0897e0`  
**Image:** `python-ai-service:t20-p215b2`

---

## Purpose

Fix the weak T20.15C control (JWT overrode header user_id) and prove rollback/restore without leaving cluster in rollback state.

---

## Method: fake allowlist fallback control

Contract user JWT identity: `2ed75568-7deb-4c29-91b0-6919f24a0c9f`

With `AI_RAG_HYBRID_CANARY=1` and allowlist set to a **fake UUID** (`00000000-0000-0000-0000-000000000000`), the authenticated contract user is **not** allowlisted → keyword path.

---

## Drill sequence and results

| Step | Env state | RAG query `retrieval_mode` | Result |
|------|-----------|---------------------------|--------|
| 1. Control | `CANARY=1`, allowlist=fake UUID | **keyword** | **PASS** |
| 2. Restore allowlist | `CANARY=1`, allowlist=contract user | **hybrid_canary** | **PASS** |
| 3. Rollback drill | `CANARY=0`, allowlist=empty | **keyword** | **PASS** |
| 4. Final KEEP | `CANARY=1`, allowlist=contract user | **hybrid_canary** | **PASS** |

### Verification commands (representative)

```bash
# Control — fake allowlist
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=1 \
  AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=00000000-0000-0000-0000-000000000000 \
  AI_RAG_HYBRID_CANARY_PERCENT=0
# → retrieval_mode=keyword

# Restore KEEP
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=1 \
  AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f \
  AI_RAG_HYBRID_CANARY_PERCENT=0 \
  AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1 \
  AI_RAG_HYBRID_LOG_PURE_VECTOR=1 \
  AI_RAG_HYBRID_ANCHOR_MAX=1
# → retrieval_mode=hybrid_canary
```

---

## Post-rollback validation (step 3)

| Check | Result |
|-------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |
| Leakage | **PASS** (inherited from soak) |

---

## Product suites note

With **canary ON**, Playwright RAG suites assert `retrieval_mode=keyword` and fail for allowlisted contract user (expected). Lane C keyword behavior is proven by:

1. Fake-allowlist control → `keyword`
2. Rollback drill (`CANARY=0`) → `keyword`
3. Seller intelligence UI PASS during soak (canary ON)

---

## Final cluster state

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
```

Image: `python-ai-service:t20-p215b2`

---

## Verdict

```text
Non-allowlisted control: PASS (fake allowlist → keyword)
Rollback drill: PASS (CANARY=0 → keyword)
Restore allowlist: PASS (hybrid_canary for contract user)
Hybrid allowlist canary: KEEP
T20.15E: NOT STARTED
```

No bench_logs or artifacts committed.
