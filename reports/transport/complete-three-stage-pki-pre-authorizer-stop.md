# Complete three-stage PKI + pre-authorizer stop

**Verdict: BLOCKED**

Prior claim “THREE-STAGE TLS PROBE VERIFIED” is reclassified as **PARTIAL_SUPERSEDED**. This stage records independent **root / intermediate / leaf** fingerprints on Kafka 36-row mTLS and edge/Jaeger DNS/SNI TLS rows.

## Trust anchors

| Role | SHA-256 |
|---|---|
| root | `E0:D3:94:15:5C:28:84:CA:C5:16:BD:18:1A:0B:79:43:8E:62:3E:33:85:8C:42:C4:A3:C0:DC:C6:28:09:F6:EB` |
| intermediate | `99:18:60:03:76:CA:CF:BC:61:72:A6:6F:F2:1A:40:14:8C:4C:AF:C4:FC:72:00:AA:EF:E7:FA:6E:D5:BD:C6:6F` |

Wire semantics: peer presents **leaf + intermediate**; **root** is the verifier trust anchor only.

## Achieved

| Gate | Result |
|---|---|
| PKI inventory | production invalid chains **0**; kafka clients **12/12** distinct leaves |
| Disk/Secret/mount equality | **12/12** |
| Real DNS (no `--resolve` acceptance) | record-platform.test → 192.168.64.244; jaeger → 192.168.64.245 |
| Edge/Jaeger SNI/SAN/path | **2/2** (OpenSSL 3) |
| Kafka 12×3 positive mTLS | **36/36** with client+broker three-stage fps |
| `client_auth_eku_absent` | **executed** (denied on 3/3 brokers) |
| Negatives skipped | **0** |
| Authorizer | **disabled**; broker-observed auth principals **0/12** |
| Peer authorization claim | **not made** |

## Not achieved (blockers)

- `missing_intermediate` negative unexpected accept **3/3** (broker sends intermediate; root-only truststore still builds path)
- Disposable 3-node controller mTLS docker rehearsal **NOT_PROVEN**
- Edge H1/H2/H3 authenticated business matrix **not run**
- Jaeger `/jaeger/api` exact-trace round-trip **not run**
- Full gRPC mTLS/peer-auth matrix **not re-run**
- Exact-SHA clean rebuild/repin **not complete**

## Stop line

```text
RECORD PLATFORM COMPLETE THREE-STAGE PKI AND PRE-AUTHORIZER TRANSPORT
REMEDIATION BLOCKED —
ROOT INTERMEDIATE AND LEAF IDENTITIES INVENTORIED —
DISK SECRET MOUNT RUNTIME CERTIFICATE CONSISTENCY VERIFIED FOR 12/12 KAFKA CLIENTS —
REAL DNS HOSTNAME SNI SAN FOR EDGE AND JAEGER VERIFIED —
KAFKA 36/36 SERVICE-TO-BROKER POSITIVE MTLS ROWS WITH PER-ROW CLIENT AND BROKER
THREE-STAGE FINGERPRINTS VERIFIED —
CLIENT_AUTH_EKU_ABSENT NEGATIVE EXECUTED —
KAFKA TLS NEGATIVES 33/36 (missing_intermediate UNEXPECTED_ACCEPT) —
CONTROLLER MTLS DOCKER REHEARSAL NOT PROVEN —
EDGE H1/H2/H3 BUSINESS MATRIX AND GRPC MATRIX AND EXACT-SHA REPIN NOT COMPLETE —
MTLS SERVICE AUTHENTICATION VERIFIED —
KAFKA SERVICE PEER AUTHORIZATION NOT YET ENABLED —
STANDARD AUTHORIZER REMAINS DISABLED —
FINAL ACLS REMAIN UNAPPLIED —
GATE5-V7 NOT CREATED —
GATE 6 PGBENCH K6 FULL PLAYWRIGHT PHASE34 OWNER VISUALS AND
PRODUCTION NOT AUTHORIZED
```
