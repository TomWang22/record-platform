# Gate 5 v7 — Kafka security runtime discovery

**Do not create gate5-v7 yet. Do not apply final ACLs yet.**

## Topology

| Field | Value |
|---|---|
| Image | `confluentinc/cp-kafka:7.5.0` |
| Kafka / Scala artifact | `kafka_2.13-7.5.0-ccs.jar` |
| Mode | **KRaft** (`process.roles=broker,controller`) |
| Brokers / nodes | kafka-0, kafka-1, kafka-2 (`node.id` 0/1/2) |
| Controllers | same three nodes (combined roles) |
| Quorum voters | `0@kafka-0…:9095,1@kafka-1…:9095,2@kafka-2…:9095` |

## Listeners

| Listener | Port | Protocol | client.auth | Keystore | Role |
|---|---|---|---|---|---|
| INTERNAL | 9093 | SSL | **required** | `/etc/kafka/secrets/kafka.keystore.jks` | clients + **inter-broker** |
| EXTERNAL | 9094 | SSL | **required** | same keystore | MetalLB external clients |
| CONTROLLER | 9095 | SSL | **none** | same keystore | controller quorum |

- `inter.broker.listener.name=INTERNAL`
- `listener.security.protocol.map=INTERNAL:SSL,EXTERNAL:SSL,CONTROLLER:SSL`
- Shared truststore: `/etc/kafka/secrets/kafka.truststore.jks`

## Inter-broker / controller identity

Brokers present the **same dual-use broker leaf** (serverAuth + clientAuth) from `kafka-ssl-secret` for:

- listener server identity (INTERNAL/EXTERNAL/CONTROLLER)
- inter-broker TLS client role on INTERNAL (peer requires clientAuth)

Classification:

```text
DUAL_USE_EKU_REQUIRED_WITH_RATIONALE
```

Separating serverAuth-only listener leaves from clientAuth-only inter-broker leaves requires per-listener keystores (not configured today). Do not replace the broker leaf with serverAuth-only without that split.

CONTROLLER has `ssl.client.auth=none`, so controller quorum does not require peer client certificates.

## Authorization (current)

| Property | Runtime value |
|---|---|
| `authorizer.class.name` | **absent** |
| `super.users` | **absent** |
| `allow.everyone.if.no.acl.found` | **absent** (default permissive without authorizer) |
| `principal.builder.class` | default → `DefaultKafkaPrincipalBuilder` |
| `ssl.principal.mapping.rules` | **absent** (no DN rewrite) |

Effective posture: mTLS authentication only; any client trusted by the CA can perform cluster operations. Same-CA wrong-service denial is impossible until StandardAuthorizer + fail-closed ACLs.

## Principal formatting (measured)

Java `X500Principal.getName()` / Kafka SSL principal for the shared leaf:

```text
User:O=record-platform,CN=kafka-client
```

For dedicated leaves with `O=Record Platform`:

```text
User:O=Record Platform,CN=<service>
```

SPIFFE URI SANs are identity evidence only; they are **not** the Kafka ACL principal unless a tested mapping rule is introduced.

## Client identity defect (unchanged until migration)

All participant workloads still mount shared `kafka-ssl-secret` → `CN=kafka-client`. Dedicated `kafka-client-tls-*` Secrets are the remediation namespace.
