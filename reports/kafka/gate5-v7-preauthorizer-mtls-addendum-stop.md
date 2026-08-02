# Pre-authorizer mTLS addendum stop

**Canary root:** `/tmp/record-platform-gate5-v7-preauthorizer-mtls-v1/`  
**Final gate5-v7:** NOT CREATED  
**Authorizer:** disabled · **ACLs:** unapplied · **Peer authorization:** not claimed

## Missing-intermediate correction

| Item | Result |
|---|---|
| Historical rows preserved | **3** |
| Classification | `INVALID_NEGATIVE_FIXTURE — INTERMEDIATE_REMOVED_FROM_WRONG SIDE OF HANDSHAKE` |
| Replacement | `peer_omits_intermediate` |
| expected/tested/denied/failed/skipped | **3/3/3/0/0** |

Denial proven with **root-only** openssl `s_server -Verify` (leaf-only client presentation).  
Live Kafka still trusts intermediate in truststore → leaf-only to Kafka **accepts** (diagnostic only; not the negative criterion).

## Matrix denominators (current)

| Surface | Result |
|---|---|
| Positive mTLS 12×3 | **36/36/36** |
| Valid TLS negatives | **36/36 denied** (0 skip) |
| Distinct client leaves | **12** |
| Disk/Secret/mount equality | **12/12** |
| Hostname verification blanked | **0** |
| Controller listener mTLS | **NOT_ENABLED** (`ssl.client.auth=none`) |
| Exact-SHA repin | **incomplete** |
| Final gate5-v7 | **false** |

## Stop line

```text
RECORD PLATFORM ALL TWELVE KAFKA PARTICIPANT MUTUAL-TLS IDENTITIES
VERIFIED —
THIRTY-SIX OF THIRTY-SIX SERVICE-TO-BROKER POSITIVE MTLS ROWS VERIFIED —
THIRTY-SIX OF THIRTY-SIX VALID TLS NEGATIVE ROWS DENIED —
PRIOR MISSING-INTERMEDIATE FIXTURE RECLASSIFIED AND REPLACED —
PEER_OMITS_INTERMEDIATE 3/3 DENIED —
INTERNAL AND EXTERNAL BROKER MTLS SERVICE AUTHENTICATION VERIFIED —
CONTROLLER LISTENER MTLS REMAINS SEPARATELY BLOCKED —
KAFKA SERVICE PEER AUTHORIZATION NOT YET ENABLED —
STANDARD AUTHORIZER REMAINS DISABLED —
FINAL ACLS REMAIN UNAPPLIED —
FINAL GATE5-V7 ROOT NOT CREATED —
EXACT-SHA REPIN NOT COMPLETE —
GATE 6 PGBENCH K6 FULL PLAYWRIGHT PHASE34 OWNER VISUALS AND PRODUCTION
NOT AUTHORIZED
```
