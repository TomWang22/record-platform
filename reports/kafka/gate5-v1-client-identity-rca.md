# Gate 5 v1 client-identity RCA (immutable)

## Preservation

| Field | Value |
|---|---|
| Root | `/tmp/record-platform-runtime-heartbeat-gate5-v1/` |
| Terminal | `FROZEN_BLOCKED_EVIDENCE` |
| Marker SHA-256 | `3719a3ceac23bb3f00717d934c64fe2fca1a88413cd157bc39bc5d8d153d3f61` |
| HARD_FAILURE SHA-256 | `db405376085b93a3728d59e0533b921950aff17839d6424b2bf84b10d3768b45` |
| Files / size | 17 files, ~152 KiB |

Do not resume, rewrite, or convert this root to PASS.

## Accepted v1 denominators

- participant services `12/12`
- logical roles `15/15`
- topics `20/20`
- consumer groups `7/7`
- live broker/event/stability matrix: **not started**

## Failing live client IDs

| Class | IDs |
|---|---|
| generic | `aiokafka-0.11.0` |
| missing role suffix | `aiokafka-0.11.0`, two `ollama-worker-ollama-worker-*` |
| duplicate live | `aiokafka-0.11.0` |
| source hardcoded (gateway) | `ollama-gateway` |

### Source defects

- **python-ai-service**: `AIOKafkaProducer` / `AIOKafkaConsumer` without `client_id` → library default.
- **ollama-worker**: `clientId: ollama-worker-${HOSTNAME}` → pod name, no role suffix, no UID token.
- **ollama-gateway**: `clientId: 'ollama-gateway'` → static generic.

### Missing pod uniqueness

- python-ai already receives `POD_UID` via deploy-time provenance patch but ignores it.
- ollama Deployments were **not** in `rp-patch-runtime-provenance-and-identity.sh` DEPLOYS list.
- Base manifests lack downward-API `RP_POD_UID` (cold bootstrap gap).

### Participant omitted from prior exact-SHA pin

- `ollama-gateway` / `ollama-worker` run Kafka but were outside Gate4 `13/14` application pin (ConfigMap + `node:22-alpine`).

## Nine missing certificate fingerprints (individual)

All nine v1 failures are **CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED**.

Certificates **are** mounted from `kafka-ssl-secret` at `/etc/kafka/secrets/client.crt`. Host-side `openssl` proves identical SHA-256 fingerprint:

`E9:7A:99:31:B6:48:EE:99:A9:5F:2E:AF:94:9F:3D:51:F4:BC:BE:8F:82:A5:01:A8:F2:63:01:3A:63:DC:10:1D`

Subject `CN=kafka-client, O=record-platform`; EKU includes **TLS Web Client Authentication**.

| # | Service | Classification |
|---|---|---|
| 1 | analytics-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 2 | auction-monitor | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 3 | auth-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 4 | listings-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 5 | media-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 6 | messaging-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 7 | notification-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 8 | shopping-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |
| 9 | trust-service | CERTIFICATE_PRESENT_COLLECTOR_LOOKUP_FAILED |

Related (not in raw nine):

| Service | Classification |
|---|---|
| python-ai-service | ROLE_USES_SHARED_PROVEN_CERTIFICATE (v1 collector OK) |
| ollama-worker | PARTICIPANT_NOT_INCLUDED_IN_RUNTIME_PIN (+ collector would fail; cert at `tls.crt` mounted) |
| ollama-gateway | PARTICIPANT_NOT_INCLUDED_IN_RUNTIME_PIN (+ collector would fail; cert at `tls.crt` mounted) |

`unknown_blocking = 0`. No manufactured fingerprints.

## Evidence-collector defect

v1 collector executed `openssl` **inside** pods. Node service images lack `openssl`; only python-ai had it. Correct proof: `kubectl exec … cat` + host OpenSSL.

## Authorization boundary

`client.id` is attribution only. Authorization remains certificate identity + ACL/policy. A forged canonical client ID with an unauthorized certificate must remain denied.
