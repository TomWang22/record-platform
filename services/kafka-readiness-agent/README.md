# Kafka readiness agent

Persistent loopback readiness sidecar for the record-platform KRaft brokers.

Replaces per-probe JVM `kafka-broker-api-versions` cold-starts with one long-lived
Go process that polls the **local** INTERNAL broker over mTLS and exposes
`GET /readyz` on `127.0.0.1:8099`.

## Hard constraints

- Does **not** modify `infra/k8s/kafka-kraft-metallb/statefulset.yaml` by default.
- HTTP bind is **loopback only**.
- One reusable franz-go client; reconnect after failure.
- Never logs keystore passwords, PEM private keys, or raw Kafka payloads.

## Build / test

```bash
cd services/kafka-readiness-agent
go test ./...
go build -o bin/kafka-readiness-agent ./cmd/kafka-readiness-agent
```

## Configuration (env)

| Variable | Default | Notes |
|----------|---------|-------|
| `POD_NAME` | (required) | Used for FQDN + ordinal |
| `NAMESPACE` / `POD_NAMESPACE` | `record-platform` | |
| `NODE_ID` | POD ordinal | Expected broker node id |
| `BROKER_ADDR` | `${POD_NAME}.kafka.${NAMESPACE}.svc.cluster.local:9093` | |
| `BROKER_SERVER_NAME` | same FQDN | TLS SNI / hostname verify |
| `HTTP_ADDR` | `127.0.0.1:8099` | Must be loopback |
| `POLL_INTERVAL` | `5s` | |
| `FRESHNESS_THRESHOLD` | `30s` | READY requires recent success |
| `RECONNECT_GRACE` | `60s` | Stuck reconnect → NOT_READY |
| `CHECK_TIMEOUT` | `10s` | Per-check deadline |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` / `TLS_CA_FILE` | | Preferred PEM (tests + converted mounts) |
| `KEYSTORE_PATH` / `TRUSTSTORE_PATH` | | PEM or password-protected PKCS12 |
| `KEYSTORE_PASSWORD` / `TRUSTSTORE_PASSWORD` / `KEY_PASSWORD` | | Or `*_PASSWORD_FILE` |

### JKS on Kubernetes

Broker secrets are JKS today. Convert JKS→PEM (or PKCS12) with an init/sidecar
before the agent starts — see `scripts/kafka-readiness-jks-to-pem.sh` and
`infra/k8s/kafka-kraft-metallb/readiness-agent/`.

## Endpoints

- `GET /livez` → `200` `{"status":"LIVE"}`
- `GET /readyz` → `200` READY / `503` NOT_READY + `reason`
- `GET /status` → structured snapshot (no secrets)
- `GET /metrics` → Prometheus

## Reason codes

`TLS_CHAIN_FAILURE`, `TLS_HOSTNAME_FAILURE`, `TLS_CLIENT_IDENTITY_FAILURE`,
`TCP_CONNECT_FAILURE`, `APIVERSIONS_FAILURE`, `METADATA_FAILURE`,
`LOCAL_NODE_ID_MISMATCH`, `STALE_LAST_SUCCESS`, `AGENT_INTERNAL_FAILURE`

## Contract

See `reports/kafka/gate5-pre-v10-readiness-agent-contract.json` and
`docs/KAFKA_READINESS_AND_ACCEPTANCE.md`.
