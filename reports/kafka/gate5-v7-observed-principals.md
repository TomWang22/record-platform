# Gate 5 v7 — broker-observed Kafka principals

**Final ACLs not applied. gate5-v7 not created.**

## Method

- Leaf subject → Java `X500Principal.getName()` (same path as Kafka `DefaultKafkaPrincipalBuilder`)
- Live proof: `kafka-broker-api-versions` over INTERNAL SSL with each `kafka-client-tls-*` leaf
- SPIFFE URI SAN present on every leaf; **not** used as ACL principal
- No `ssl.principal.mapping.rules`

## Distinct principals (12/12)

| Service | Broker-observed principal | Live mTLS |
|---|---|---|
| analytics-service | `User:O=Record Platform,CN=analytics-service` | accepted |
| auction-monitor | `User:O=Record Platform,CN=auction-monitor` | accepted |
| auth-service | `User:O=Record Platform,CN=auth-service` | accepted |
| listings-service | `User:O=Record Platform,CN=listings-service` | accepted |
| media-service | `User:O=Record Platform,CN=media-service` | accepted |
| messaging-service | `User:O=Record Platform,CN=messaging-service` | accepted |
| notification-service | `User:O=Record Platform,CN=notification-service` | accepted |
| python-ai-service | `User:O=Record Platform,CN=python-ai-service` | accepted |
| shopping-service | `User:O=Record Platform,CN=shopping-service` | accepted |
| trust-service | `User:O=Record Platform,CN=trust-service` | accepted |
| ollama-gateway | `User:O=Record Platform,CN=ollama-gateway` | accepted |
| ollama-worker | `User:O=Record Platform,CN=ollama-worker` | accepted |

Historical shared principal (still mounted by app workloads until migration):

```text
User:O=record-platform,CN=kafka-client
```

## Denominators

```text
services expected/observed = 12/12
live_mtls_accepted = 12/12
distinct_observed_service_principals = 12
shared_generic_principal_observations = 0
final_acl_manifest_authorized = false
gate5_v7_authorized_to_create = false
```

Machine-readable: `reports/kafka/gate5-v7-observed-principals.json`
