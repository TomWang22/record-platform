# AI provider operations (Record Platform)

Operator runbook for Ollama, embeddings, RAG, and event flow. Observe/fix only — no product feature changes.

## Topology

| Service | DNS | Port | Notes |
|---------|-----|------|-------|
| Ollama (in-cluster) | `ollama.record-platform.svc.cluster.local` | 11434 | Primary for python-ai |
| Ollama MetalLB | `ollama-lb` LoadBalancer | 11434 | External/debug (`kubectl get svc ollama-lb -n record-platform`) |
| Ollama gateway | `ollama-gateway.record-platform.svc.cluster.local` | 8081 | Health proxy |
| python-ai | `python-ai-service.record-platform.svc.cluster.local` | 5005 | AI HTTP + `/api/ai/*` via edge |

**Do not use** stale DNS `ollama.ollama.svc.cluster.local` (wrong namespace).

## Fix Ollama DNS / provider env

```bash
bash scripts/rp-ai-apply-ollama-cluster-env.sh
```

Canonical values:

```bash
OLLAMA_BASE_URL=http://ollama.record-platform.svc.cluster.local:11434
AI_OLLAMA_MODEL=llama3.2:1b
AI_EMBEDDING_MODEL=nomic-embed-text
AI_OLLAMA_TIMEOUT_MS=5000
AI_RAG_MAX_CHUNKS=8
AI_RAG_MAX_CONTEXT_TOKENS=2048
AI_MAX_RESPONSE_TOKENS=512
AI_MODEL_PROVIDER=rule          # rule-engine fallback; set ollama only when ready
AI_TRANSFORMER_ENABLED=0
```

Rollout:

```bash
kubectl rollout status deployment/python-ai-service -n record-platform --timeout=300s
```

## Ollama health checks

From host (MetalLB):

```bash
LB=$(kubectl get svc -n record-platform ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -sfS "http://${LB}:11434/api/tags" | python3 -m json.tool
curl -sfS "http://${LB}:11434/api/version"
```

From python-ai pod:

```bash
kubectl exec -n record-platform deploy/python-ai-service -c app -- python3 -c "
import asyncio, httpx
async def main():
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get('http://ollama.record-platform.svc.cluster.local:11434/api/tags')
        print(r.status_code, r.json())
asyncio.run(main())
"
```

Phase 17 readiness script:

```bash
bash scripts/rp-ai-ollama-readiness.sh
```

## Model availability

List models (no auto-pull in Phase 17):

```bash
kubectl exec -n record-platform deploy/ollama -- ollama list
```

Expected generation model: `llama3.2:1b`. Embedding model `nomic-embed-text` may be absent; embeddings stay degraded with BYTEA/keyword retrieval.

Live generate smoke (manual):

```bash
kubectl exec -n record-platform deploy/python-ai-service -c app -- python3 -c "
import asyncio, httpx, json
async def main():
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.post('http://ollama.record-platform.svc.cluster.local:11434/api/generate',
          json={'model':'llama3.2:1b','prompt':'ping','stream':False,'options':{'num_predict':8}})
        print(json.dumps(r.json())[:200])
asyncio.run(main())
"
```

## Rule-engine fallback

When `AI_MODEL_PROVIDER=rule` (default):

- Responses use `model_used=rule-engine`
- `source_status=live` when `source_refs` present
- `source_status=degraded` with `degraded_reason` when corpus/provider missing
- No fabricated LLM prose

Check status:

```bash
curl -sfS --cacert certs/dev-chain.pem \
  --resolve record-platform.test:443:$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}') \
  https://record-platform.test/api/ai/rag/status | python3 -m json.tool
```

## RAG reindex

```bash
bash scripts/rp-ai-rag-reindex.sh --all
bash scripts/audit-rp-ai-rag-contract.sh
```

## Embeddings / pgvector

Check extension (do not force in dev):

```bash
# Non-interactive probes — always set PGPASSWORD and PGCONNECT_TIMEOUT
PGPASSWORD=postgres PGCONNECT_TIMEOUT=5 \
psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -v ON_ERROR_STOP=1 -At -c \
  "SELECT COALESCE((SELECT extname FROM pg_extension WHERE extname='vector'), 'missing');"
PGPASSWORD=postgres PGCONNECT_TIMEOUT=5 \
psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -v ON_ERROR_STOP=1 -At -c \
  "SELECT COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_document_chunks' AND column_name='embedding'), 'missing');"
```

Or use the shared helper from scripts:

```bash
source scripts/lib/rp-python-ai-psql.sh
rp_python_ai_psql_connect_check
rp_python_ai_psql "SELECT COALESCE((SELECT extname FROM pg_extension WHERE extname='vector'), 'missing');"
```

BYTEA fallback is valid; retrieval stays `keyword`.

Provider readiness:

```bash
bash scripts/rp-ai-provider-readiness.sh
```

## RAG quality smoke

```bash
bash scripts/rp-ai-rag-quality-smoke.sh
```

## Event / outbox checks

```bash
bash scripts/rp-event-lag-monitor.sh
bash scripts/rp-ai-outbox-publish-drain.sh
bash scripts/audit-rp-event-outbox-contract.sh
```

## Soak monitor

```bash
bash scripts/rp-ai-soak-monitor.sh
# SOAK_DURATION_SECONDS=120 for quick check
```

## Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ollama.ollama.svc` DNS error | Stale `OLLAMA_BASE_URL` | `bash scripts/rp-ai-apply-ollama-cluster-env.sh` |
| `model_present=false` | Model not pulled | Document missing model; keep `AI_MODEL_PROVIDER=rule` |
| `embedding_model_present=false` | `nomic-embed-text` absent | Expected; keyword retrieval continues |
| `source_status=degraded` + `record_not_in_corpus` | Record not indexed | `bash scripts/rp-ai-rag-reindex.sh --all` |
| Rule-engine only | `AI_MODEL_PROVIDER=rule` | Intentional fallback until Ollama validated |

## Phase 17 gate bundle

```bash
bash scripts/phase-17-provider-gates.sh
```
