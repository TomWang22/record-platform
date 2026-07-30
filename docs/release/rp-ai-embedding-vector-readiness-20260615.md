# Record Platform AI embedding & vector readiness — Phase 18 lock

Generated: 2026-06-15  
Edge: `https://record-platform.test` (strict TLS only)

## Release identity

| Field | Value |
|-------|-------|
| Proof chain SHA (T18.7) | `90d4026c0eeba776570576ea7646ea579a14cb48` |
| Closeout lock | This commit (`chore(ai): lock embedding vector readiness proof`) |
| Phase | **18 — embedding/vector readiness (locked)** |
| Phase 19 | **Not started** |
| Prepared tag (not created) | `rp-ai-vector-readiness-20260615` |

## Phase 18 proof chain

| Ticket | Scope | Status |
|--------|-------|--------|
| **T18.0R** | gRPC/mTLS probe architecture fix (python-ai) | Green |
| **T18.3** | pgvector DB image swap (`pgvector/pgvector:pg16`) | Green |
| **T18.4** | `nomic-embed-text` embedding model pull + dim proof | Green |
| **T18.5** | Small batch embedding backfill (≤100 chunks) | Green |
| **T18.6** | Hybrid vector **shadow** diagnostics (opt-in only) | Green |
| **T18.7** | Controlled balanced embedding sample + analytics validation | Green |

**Locked behavior:** keyword retrieval remains production default; vector retrieval is shadow/diagnostic only; no full corpus backfill.

## DB topology

| Item | Value |
|------|-------|
| Host port | `127.0.0.1:5440` |
| Database | `python_ai` |
| Schema | `ai` |
| Docker image | `pgvector/pgvector:pg16` |
| Volume | preserved across T18.3 image swap |

### pgvector extension

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- vector | <installed>
```

Status: **present** (verified T18.3+).

### Embedding columns (`ai.ai_document_chunks`)

| Column | Type | Status |
|--------|------|--------|
| `embedding` | `bytea` | **preserved** (legacy/fallback path) |
| `embedding_vec` | `vector(768)` | **live** (pgvector cosine search for shadow) |
| `embedding_model` | `text` | set on embedded rows (`nomic-embed-text`) |
| `embedding_status` | `text` | `embedded` on backfilled rows |
| `embedding_updated_at` | `timestamptz` | set on backfill |

Dimension proof:

```sql
SELECT count(*) AS wrong_dim
FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL
  AND vector_dims(embedding_vec) <> 768;
-- 0
```

## Model status (Ollama cluster)

| Model | Purpose | Status |
|-------|---------|--------|
| `llama3.2:1b` | optional generation | **present** |
| `nomic-embed-text` | embeddings (768-dim) | **present** |

Runtime provider policy:

| Provider | Status |
|----------|--------|
| **rule-engine** | **default** (`AI_MODEL_PROVIDER=rule`) |
| **Ollama** | embedding path live; generation optional |
| **HuggingFace** | **disabled** (`disabled_by_default`) |
| **PyTorch** | **disabled** (`disabled_by_default`) |
| **TensorFlow** | **disabled** (`disabled_by_default`) |

## Embedded corpus sample (controlled — not full backfill)

| source_type | embedded chunks |
|-------------|----------------:|
| record | 500 |
| listing | 500 |
| obo_offer_summary | 300 |
| auction_bid_summary | 253 |
| notification | 200 |
| listing_revision | 200 |
| **Total embedded** | **1,953** |
| **Remaining unembedded** | **71,054** |

Full corpus backfill: **not started** (~97% of chunks still keyword-only).

## Retrieval mode

| Setting | Value |
|---------|-------|
| Production default | `keyword` |
| Vector retrieval default | **off** |
| Shadow vector | **opt-in only** (`AI_RAG_SHADOW_VECTOR=1` or `?shadow_vector=1`) |
| Shadow alters response | **no** — diagnostics in `details.shadow_vector` only |

Shadow smoke scripts:

```bash
SHADOW_CAPTURE_BASELINE=1 bash scripts/rp-ai-rag-shadow-smoke.sh  # optional baseline
bash scripts/rp-ai-rag-shadow-smoke.sh
```

## Privacy guarantees (locked)

1. Owner scope first (`visibility` + `owner_user_id`)
2. Public listing visibility rules enforced in retrieval SQL
3. No `message` docs unless `metadata.opt_in=true`
4. No proxy max (`max_bid_cents`, `proxy_bids`, `proxy max`) in corpus or responses
5. No raw bidder IDs in AI outputs (masked bid summaries only)
6. No private OBO message bodies in corpus or OBO helper paths
7. Shadow vector applies **same filters** as keyword path (T18.6B audit assertions)

Leakage SQL proof (embedded subset):

```sql
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type = 'message' AND c.embedding_vec IS NOT NULL;
-- 0

SELECT count(*) FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL
  AND content ~* 'max_bid_cents|proxy_bids|proxy max';
-- 0
```

## Operational scripts

| Script | Purpose |
|--------|---------|
| `scripts/rp-ai-pgvector-readiness.sh` | pgvector extension + column proof |
| `scripts/rp-ai-embedding-model-readiness.sh` | Ollama embed model + 768-dim |
| `scripts/rp-ai-embedding-backfill-small.sh` | ≤100 chunk proof backfill |
| `scripts/rp-ai-embedding-backfill-controlled.sh` | balanced per-type sample (≤1000/run) |
| `scripts/rp-ai-rag-shadow-smoke.sh` | shadow vs keyword comparison |
| `scripts/rp-ai-analytics-output-validation.sh` | analytics → python-ai grounding |

## Rollback commands

**Do not run unless explicitly approving rollback.** BYTEA `embedding` column and keyword retrieval remain safe fallbacks.

1. **Disable shadow vector diagnostics (no DB change):**

   ```bash
   kubectl -n record-platform set env deploy/python-ai-service AI_RAG_SHADOW_VECTOR=0
   kubectl -n record-platform rollout status deploy/python-ai-service
   ```

2. **Revert retrieval to keyword-only code path:** deploy python-ai image from pre-T18.6 SHA (`af207cb` parent chain) — shadow fields absent; keyword unchanged.

3. **Clear vector embeddings only (keeps chunks + BYTEA):**

   ```sql
   UPDATE ai.ai_document_chunks
   SET embedding_vec = NULL,
       embedding_status = 'pending',
       embedding_model = NULL,
       embedding_updated_at = NULL
   WHERE embedding_vec IS NOT NULL;
   ```

4. **Revert DB image (last resort — requires migration plan):** change `postgres-python-ai` in `docker-compose.yml` from `pgvector/pgvector:pg16` to `postgres:16-alpine`, restore from pre-T18.3 backup. **Not recommended** without ops approval; use backup `backups/rp-all-11-t18-embedding-vector-lock` or prior snapshot.

5. **Restore python_ai from backup:**

   ```bash
   # Use manifest in backups/rp-all-11-t18-embedding-vector-lock/
   # pg_restore -h 127.0.0.1 -p 5440 -U postgres -d python_ai --clean --if-exists <dump>
   ```

## Phase 19 boundary

Phase 19 (larger staged backfill **or** production vector retrieval rollout) is **not started**. Do not enable vector as default retrieval or run full corpus backfill without explicit approval.

## Gate bundle (P18-CLOSE-2)

```bash
pnpm install --frozen-lockfile
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-ollama-readiness.sh
bash scripts/rp-ai-rag-shadow-smoke.sh
bash scripts/rp-ai-analytics-output-validation.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-bootstrap-grpc-mtls-gate.sh
bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh
bash scripts/smoke-rp-mtls-real.sh
bash scripts/audit-rp-redis-lua-runtime-contract.sh
bash scripts/audit-rp-event-outbox-contract.sh
bash scripts/rp-runtime-domain-comb.sh
bash scripts/rp-db-domain-comb.sh
bash scripts/rp-rp-decontaminate-scan.sh
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
CONTRACT_ONLY=1 make rp-frontend-screenshot-strict-contract
make e2e-full-strict   # 270 tests; closeout run 4: 268 passed, 2 skipped, 0 failed
```
