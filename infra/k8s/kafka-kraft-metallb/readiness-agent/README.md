# Kafka readiness agent — future rollout (NOT applied)

This directory holds manifests and notes for replacing the per-probe JVM
`kafka-broker-api-versions` readiness check with a persistent Go sidecar.

## Status

| Item | State |
|------|--------|
| Live `statefulset.yaml` | **Untouched** — JVM exec probe remains |
| This directory | Reference only |
| Apply to cluster | **Forbidden** until A/B gate passes |

## How kubelet should probe

Once rolled out, the kafka container (or shared pod network namespace) readiness
probe becomes an HTTP check against the sidecar loopback listener:

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8099
    host: 127.0.0.1
    scheme: HTTP
  periodSeconds: 5
  timeoutSeconds: 2
```

Kubelet → `http://127.0.0.1:8099/readyz` inside the pod network namespace.

- `200` + `{"status":"READY"}` → Ready
- `503` + `{"status":"NOT_READY","reason":"..."}` → Not Ready

## Sidecar model

1. **Init (optional):** convert `/etc/kafka/secrets/*.jks` → PEM under `/etc/kafka/pem`
   using `scripts/kafka-readiness-jks-to-pem.sh` (needs `keytool` + `openssl`).
2. **Sidecar:** `kafka-readiness-agent` mounts secrets + PEM, polls
   `${POD_NAME}.kafka.${NAMESPACE}.svc.cluster.local:9093` with HTTPS hostname
   verification, ApiVersions + Metadata, expected `NODE_ID`.
3. **Broker container:** readinessProbe points at loopback `/readyz` (no JVM spawn).

## Files

- `configmap-env.yaml` — env defaults for PEM paths and intervals
- `statefulset-patch-DO_NOT_APPLY_UNTIL_AB_PASSES.yaml` — illustrative patch

## A/B gate (required before apply)

Compare current JVM probe vs sidecar on the same cluster for:

- Ready success rate / flap rate
- Probe latency (p50/p95)
- Broker JVM CPU/RSS during probe windows
- Application produce/consume error rates

Only after A/B passes and explicit authorization may `statefulset.yaml` be updated.
