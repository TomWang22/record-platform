# Gate 5 v7 — principal inventory (pre-authorizer)

**Evidence class: `KAFKA_EQUIVALENT_DERIVED_PRINCIPAL_WITH_LIVE_MTLS_ACCEPTANCE`**

These strings are **not** yet `BROKER_OBSERVED_AUTHORIZATION_PRINCIPAL`.
Promotion requires an authorizer ALLOW/DENY decision that records the exact principal.

## Method

- Leaf subject → Java `X500Principal.getName()` (DefaultKafkaPrincipalBuilder equivalent)
- Live proof: `kafka-broker-api-versions` over INTERNAL SSL with each dedicated leaf
- SPIFFE URI SAN present; **not** the ACL principal
- No `ssl.principal.mapping.rules`
- Authorizer: **absent**

## Distinct principals (12/12 derived)

| Service | Derived Kafka principal | Live mTLS ApiVersions |
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

```text
services expected/derived = 12/12
broker_observed_authorization_principals = 0/12
final_acl_apply_authorized = false
gate5_v7_authorized_to_create = false
```
