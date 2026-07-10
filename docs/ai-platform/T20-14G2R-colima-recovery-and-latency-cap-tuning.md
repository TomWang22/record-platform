# T20.14G2R — Colima recovery and latency cap tuning

**Status:** Implemented  
**Generated:** 2026-06-29  
**Baseline SHA:** `252234a` (T20.14G2 eval)  
**Deploy tag:** `python-ai-service:t20-p214g2r`

---

## C0 — Colima/k3s recovery

macOS software update had stopped Colima. Recovery:

```bash
colima start --kubernetes
docker context use colima
kubectl config use-context colima
kubectl get nodes
kubectl -n record-platform rollout restart deployment/python-ai-service ...
```

**Outcome:** Colima/k3s **Ready** (`v1.29.6+k3s1`). AI stack pods restarted after VM boot.

### DB / HNSW verification

| Check | Result |
| ----- | ------ |
| pgvector extension | `0.8.2` |
| Embedded chunks | **10,065** |
| HNSW index | `ai_document_chunks_embedding_vec_hnsw_idx` **present** |

Pre-recovery health scripts: provider readiness, pgvector readiness, OCH scan — **PASS**.

---

## G2R implementation summary

G2 fixed true zero-results but regressed shadow/candidate_fetch latency (global retry before anchors). G2R makes fallback **cheap** while preserving zero-result fix.

### Behavior changes

1. **Anchor-first fallback** — When safe keyword anchors exist, apply K≤2 anchors before any global retry. Telemetry: `zero_result_fallback_stage=keyword_anchor_first`, `global_retry_skipped=true`, `global_retry_skip_reason=safe_keyword_anchors_available`.

2. **Capped global retry** — Emergency fallback uses `min(4, max_chunks)` not full `shadow_global_fetch_limit`. Telemetry: `global_retry_limit`, `global_retry_candidate_count`.

3. **Notification OBO floor without broad fanout** — When `obo_as_notification_evidence`, skip broad global fetch in route fetch path; typed floor fetches only. Telemetry: `global_retry_skip_reason=obo_floor_satisfied`.

4. **Catalog/listing floor** — When typed pool empty but floor types pending, skip broad global until floor typed fetches run (`source_type_floor_pending`).

5. **Preserved vector failure telemetry** — `vector_only_zero_result`, `shadow_selected_count_before/after_fallback`, `zero_result_fallback_applied`, `true_zero_result_after_fallback`.

---

## Changed files

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | Anchor-first fallback, capped global retry, fetch-path global skip |
| `services/python-ai-service/app/ai/shadow_profiles.py` | `shadow_fallback_global_retry_limit`, floor `skip_broad_global_retry` |
| `services/python-ai-service/tests/test_t20_14g2r_shadow_overlap_latency_cap.py` | G2R unit tests (5 cases) |
| `services/python-ai-service/tests/test_t20_14g2_shadow_overlap_v2.py` | Updated global retry test for capped path |
| `scripts/rp-ai-shadow-real-query-timing.sh` | `global_retry_skipped` aggregate |

---

## Tests

```bash
cd services/python-ai-service
source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/ -q
```

**240 passed** including G2R latency cap tests.

Contracts: audit RAG, quality smoke, endpoints, provider/pgvector readiness, OCH scan — **PASS**.

---

## Deploy

```bash
docker build -f services/python-ai-service/Dockerfile -t python-ai-service:t20-p214g2r .
kubectl -n record-platform set image deployment/python-ai-service app=python-ai-service:t20-p214g2r
```

Verified image: `python-ai-service:t20-p214g2r`

---

## Non-goals

- No vector/hybrid production default
- No T20.14H / T20.15
- No DB index changes or embedding tranches
- No keyword production or Phase 21 product changes

---

## Final verdict

```text
T20.14G2R latency cap tuning: IMPLEMENTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
```
