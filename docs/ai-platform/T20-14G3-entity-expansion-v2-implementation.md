# T20.14G3 — Entity expansion v2 implementation

**Status:** Implemented  
**Generated:** 2026-06-29  
**Baseline SHA:** `5d69169` (T20.14G2R eval)  
**Deploy tag:** `python-ai-service:t20-p214g3`

---

## C1 — shopping-service recovery

**Root cause:** Redis `ETIMEDOUT` after Colima VM restart — `redis-external` endpoints stale; shopping-service readiness probe returned 503.

**Fix:**
```bash
bash scripts/sync-redis-external-endpoints.sh
kubectl -n record-platform rollout restart deployment/shopping-service
```

**Outcome:** `shopping-service` **1/1 Running** (`78c68948d6-pgfsg`).

---

## G3 implementation summary

Shadow-only entity expansion v2 runs **after G2R fallback** when diagnostics + keyword chunks are exposed:

1. Build bounded entity set from keyword + shadow refs (metadata, source_refs, document_id, safe UUID bridges — no message bodies)
2. Fetch typed sibling candidates via metadata/source_id bridges (no broad global retry)
3. Add up to **2** privacy-safe entity-expanded chunks, tagged `entity_expansion_added`
4. Record before/after doc/entity overlap telemetry

### Caps

| Parameter | Value |
| --------- | ----: |
| `entity_expansion_max_entities` | 3 |
| `entity_expansion_max_candidates_per_entity` | 2 |
| `entity_expansion_max_added` | 2 |
| `entity_expansion_fetch_limit` | 8 |

### Source-type rules

Query-intent allowlists via `resolve_entity_expansion_allowed_source_types()` — catalog/listing, OBO/notification, auction psychology paths per T20.14G design.

---

## Changed files

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | Entity extraction v2, sibling fetch, post-fallback expansion |
| `services/python-ai-service/app/ai/shadow_profiles.py` | G3 caps + allowlist resolver |
| `services/python-ai-service/tests/test_t20_14g3_entity_expansion_v2.py` | G3 unit tests |
| `services/python-ai-service/tests/test_t20_14g2_shadow_overlap_v2.py` | Isolate anchor test from expansion |
| `scripts/rp-ai-shadow-real-query-timing.sh` | `entity_expansion_added` aggregate |

---

## Telemetry fields

```text
entity_expansion_attempted
entity_expansion_succeeded
entity_expansion_entities
entity_expansion_candidate_count
entity_expansion_added_count
entity_expansion_added_source_types
entity_expansion_skip_reason
doc_overlap_before_entity_expansion
doc_overlap_after_entity_expansion
entity_overlap_before_entity_expansion
entity_overlap_after_entity_expansion
```

---

## Tests

```bash
cd services/python-ai-service
source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/ -q
```

**251 passed** including `test_t20_14g3_entity_expansion_v2.py`.

Contracts: audit RAG, quality smoke, endpoints, provider/pgvector readiness, OCH scan — **PASS**.

---

## Deploy

```bash
docker build -f services/python-ai-service/Dockerfile -t python-ai-service:t20-p214g3 .
kubectl -n record-platform set image deployment/python-ai-service app=python-ai-service:t20-p214g3
```

---

## Non-goals

- No vector/hybrid production default
- No T20.14H / T20.15
- No DB index changes or embedding tranches
- No keyword production or Phase 21 product changes

---

## Final verdict

```text
T20.14G3 entity expansion v2: IMPLEMENTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
```
