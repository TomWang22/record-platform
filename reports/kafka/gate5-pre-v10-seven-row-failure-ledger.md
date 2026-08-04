# Gate 5 pre-v10 seven-row failure ledger

- Serial matrix: **36/36/29/7/0**

- Identities known: **4/7**; historically missing identities: **3/7**

- stdout/stderr/timestamps/pcap: **0/7** retained (WORKDIR deleted)

## Classification posture

- `node_failure_root_cause = UNRESOLVED`

- `probe_induced_load = HYPOTHESIS_UNDER_TEST`

- `colima_capacity_failure = HYPOTHESIS_UNDER_TEST`

- `kafka_protocol_instability = RUNTIME_PROVEN`

- `serial_matrix_stable = false`

## Known failures

| # | service | broker | exit | harness class | refined |
|---|---------|--------|------|---------------|---------|
| 1 | trust-service | 0 | 1 | `TLS_HANDSHAKE_COMPLETE_KAFKA_PROTOCOL_FAILED` | `UNKNOWN_WITH_COMPLETE_RAW_EVIDENCE` |
| 2 | ollama-gateway | 1 | 1 | `TLS_HANDSHAKE_COMPLETE_KAFKA_PROTOCOL_FAILED` | `UNKNOWN_WITH_COMPLETE_RAW_EVIDENCE` |
| 3 | ollama-worker | 0 | 1 | `BROKER_DISCONNECTED` | `KAFKA_APIVERSIONS_REMOTE_DISCONNECT` |
| 4 | ollama-worker | 2 | 1 | `BROKER_DISCONNECTED` | `KAFKA_APIVERSIONS_REMOTE_DISCONNECT` |

## Unknown identities (3)

Among truncated early ROW lines: analytics/auction/auth/listings × {0,1,2} and media×kafka-0.

## Node event accounting (correction)

39 NodeNotReady lines include pod fan-out; unique node Ready=False transition lines observed: **2**; Ready=True: **1**. Root cause still **UNRESOLVED**.

