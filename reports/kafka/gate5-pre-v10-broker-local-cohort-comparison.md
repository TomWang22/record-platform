# Broker-local cohort comparison

- ts: `2026-08-05T03:21:39Z`
- KAFKA_2_LOCALITY_SIGNAL: **`SUPPORTED_NOT_CAUSAL`**
- rationale: kafka-2 accounts for 4/5 failures (4/36 vs 0/36 on kafka-1 and 1/36 on kafka-0). This is a material locality signal but n_fail=5 does not prove kafka-2 is defective.

| broker | expected/tested/passed/failed | failure rate | layers |
|---|---|---:|---|
| kafka-0 | `36/36/35/1` | 0.0278 | {'KAFKA_APIVERSIONS_DISCONNECT': 1} |
| kafka-1 | `36/36/36/0` | 0.0000 | {} |
| kafka-2 | `36/36/32/4` | 0.1111 | {'KAFKA_INVALID_RESPONSE': 3, 'KAFKA_APIVERSIONS_DISCONNECT': 1} |

Agent classification: `HARDENING_CANDIDATE_NOT_CAUSAL_REMEDIATION`.

