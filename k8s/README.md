# Root `k8s/` manifests (Ollama gateway stack)

Applied by `scripts/apply-ollama-gateway-stack.sh` during bootstrap **P7a** (unless `BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1`).

| File | Purpose |
|------|---------|
| `ollama-gateway-configmap.yaml` | Gateway Node app (package.json + server.js) |
| `ollama-gateway.yaml` | Gateway Deployment + Service |
| `ollama-worker-configmap.yaml` | Worker Node app |
| `ollama-worker.yaml` | Worker Deployment + Service |
| `redis.yaml` | In-cluster Redis Stack (only when `OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=0`) |

Namespace: **record-platform**. Kafka TLS secret: **kafka-ssl-secret**.

Source: ported from internal cold-bootstrap toolkit reference (legacy paths removed from product runtime).
