# Gate 5 v7 — service-specific certificate / ACL matrix

**Status: REMEDIATION REQUIRED — do not create gate5-v7 yet**

Gate 5 v6 remains immutable (`FUNCTIONAL_PASS_EVIDENCE_INCOMPLETE`).

## Comb result (certs/ + live cluster)

### What already exists

| Asset | Finding |
|---|---|
| `certs/dev-root.pem` | Present; SHA-256 `E0:D3:94:15:5C:28:84:CA:C5:16:BD:18:1A:0B:79:43:8E:62:3E:33:85:8C:42:C4:A3:C0:DC:C6:28:09:F6:EB` |
| `certs/dev-intermediate.pem` | Present; SHA-256 `99:18:60:03:76:CA:CF:BC:61:72:A6:6F:F2:1A:40:14:8C:4C:AF:C4:FC:72:00:AA:EF:E7:FA:6E:D5:BD:C6:6F` |
| Per-service leaves in `certs/<service>.crt` | **10/12** Kafka participants present (distinct fingerprints, chain OK, key match OK) |
| `service-tls-<service>` Secrets | Match folder leaves for the 10 services |
| Kafka broker leaf | Present (`CN=kafka`); dual-use EKU (serverAuth+clientAuth) |

### What is wrong for Gate 5 acceptance

| Defect | Evidence |
|---|---|
| **All Kafka participants mount one generic client leaf** | `kafka-ssl-secret` → `/etc/kafka/secrets/client.crt` = `CN=kafka-client, O=record-platform` fingerprint `E9:7A:99:31:B6:48:EE:99:A9:5F:2E:AF:94:9F:3D:51:F4:BC:BE:8F:82:A5:01:A8:F2:63:01:3A:63:DC:10:1D` |
| Service-specific leaves **not** used as Kafka client certs | Env `KAFKA_CLIENT_CERT=/etc/kafka/secrets/client.crt` while `service-tls` is mounted separately for app TLS |
| **ollama-gateway / ollama-worker** | No `certs/ollama-*.crt` leaves |
| SPIFFE URI SAN | **0** existing service leaves have `spiffe://…` |
| EKU posture | Existing service leaves are **dual-use** (clientAuth+serverAuth); preferred Kafka client = clientAuth-only; broker preferred = serverAuth-only |
| Kafka ACLs / authorizer | **Not configured** in live `kafka.properties` — mTLS authn only; same-CA wrong-service **cannot** be denied |

### Distinct folder fingerprints (not mounted for Kafka)

| Service | Folder leaf SHA-256 | Subject | EKU | SPIFFE |
|---|---|---|---|---|
| analytics-service | `76:19:DC:B5:6D:27:A6:8E:20:3D:47:E1:F7:E5:98:EE:94:B1:4E:37:27:D9:DE:81:81:F2:EA:2F:31:4D:B0:9E` | CN=analytics-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| auction-monitor | `51:EA:12:2C:F5:49:E2:F1:8E:36:5C:0D:1B:2E:45:A7:D5:2E:C2:C3:21:A7:03:CE:F6:9F:10:FB:51:30:C5:47` | CN=auction-monitor, O=Record Platform | clientAuth,serverAuth | ABSENT |
| auth-service | `F3:65:98:1A:CA:1C:2A:52:B9:9E:BD:2B:AD:F1:62:D8:18:2E:21:FE:44:CD:1E:3F:EB:30:A5:A4:DF:C3:16:E7` | CN=auth-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| listings-service | `9F:6B:55:41:EF:DE:B2:5E:81:D6:68:CD:32:26:FD:13:B9:F2:51:D9:37:A9:84:F4:59:EA:1E:08:CC:04:A3:8C` | CN=listings-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| media-service | `67:E4:EF:6A:D7:7A:D5:CD:86:79:02:73:F6:3D:60:E1:3A:EE:96:8D:B4:4C:50:ED:E2:D9:96:D6:9E:DD:FD:9C` | CN=media-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| messaging-service | `84:DE:8D:23:3E:5E:C9:FF:26:2A:93:9A:6B:A5:F6:A3:6A:A9:92:D3:C0:01:A8:E9:92:43:17:6B:5A:3C:D0:52` | CN=messaging-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| notification-service | `C3:7C:D4:B9:9B:FC:FE:54:DC:9E:E4:06:65:A6:5A:2B:5C:23:1E:CE:6A:ED:15:59:97:9D:82:5C:1D:86:24:3F` | CN=notification-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| python-ai-service | `45:B9:AE:65:54:57:6D:ED:1C:3A:35:2D:05:28:D2:D8:05:C1:32:91:59:A3:33:BC:56:E5:B4:9E:88:A0:C6:78` | CN=python-ai-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| shopping-service | `7E:5E:D9:E1:E3:D5:38:C6:49:70:31:47:C3:2E:23:82:5F:CD:8D:F4:2A:7C:17:D5:98:AB:71:73:10:B5:7B:96` | CN=shopping-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| trust-service | `D7:42:96:EC:0F:AC:B7:65:A7:DF:81:AE:38:D7:A9:B2:A2:B5:99:D0:87:D0:A6:E2:F1:49:17:C6:1F:FE:00:A4` | CN=trust-service, O=Record Platform | clientAuth,serverAuth | ABSENT |
| ollama-gateway | `MISSING` | — | — | ABSENT |
| ollama-worker | `MISSING` | — | — | ABSENT |


### Runtime Kafka principal today (every role)

```
subject: CN=kafka-client, O=record-platform
fingerprint: E9:7A:99:31:B6:48:EE:99:A9:5F:2E:AF:94:9F:3D:51:F4:BC:BE:8F:82:A5:01:A8:F2:63:01:3A:63:DC:10:1D
secret: kafka-ssl-secret
path: /etc/kafka/secrets/client.crt
service_specific: false
```

Nineteen roles referencing this one leaf ≠ nineteen service identities.

## ACL / principal mapping

- **Current:** `MTLS_AUTHENTICATION_WITHOUT_SERVICE_ACL_AUTHORIZER`
- **Target:** SPIFFE/DN principal per service + topic/group ACLs (see `gate5-v7-acl-contract.json`)
- **client.id:** attribution only (must not authorize)

## CI gate (before v7)

`kafka-dns-validate` was **REQUIRED_AND_FAILED** because `infra/k8s/base/observability/jaeger-query-metallb.yaml` was referenced by Kustomize but not tracked in Git.

Required before gate5-v7 creation:

  workflows expected/passed/failed = 8/8/0

## Artifacts (repo, not /tmp)

- `reports/kafka/gate5-v7-service-identity-contract.json`
- `reports/kafka/gate5-v7-principal-mapping.json`
- `reports/kafka/gate5-v7-acl-contract.json`
- `reports/kafka/gate5-v7-certificate-acl-matrix.json`
- `reports/kafka/gate5-v7-certificate-acl-matrix.md` (this file)

## Next remediation (not done in this report)

1. Track Jaeger MetalLB manifest; green exact-SHA CI
2. Issue ollama leaves; add SPIFFE SANs; prefer clientAuth-only Kafka client leaves
3. Wire each participant Kafka client paths to its service leaf (or kafka-client-<service> secret)
4. Enable Kafka authorizer + ACL contract
5. Rebuild/repin; PKI canary; then create `/tmp/.../gate5-v7/`
