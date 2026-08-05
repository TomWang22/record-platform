# Five-row failure attribution

- ts: `2026-08-05T02:39:27Z`
- run: `baseline-1785877112309-cfe2081c`
- attributed: `5/5`
- CURRENT_JVM_PROBE_CAUSALITY: **`NOT_SUPPORTED`**
- rationale: Failure rate with readiness overlap is not higher than with zero overlap; current evidence does not support readiness-probe causation. Broker-local issues remain primary alternatives.

| test_id | round | service | broker | baseline layer | causal layer | overlap | confidence |
|---|---:|---|---:|---|---|---:|---|
| `r1-analytics-service-b2-1785877568532` | 1 | analytics-service | 2 | KAFKA_INVALID_RESPONSE | KAFKA_INVALID_RESPONSE | 1 | HIGH |
| `r2-ollama-worker-b2-1785885765937` | 2 | ollama-worker | 2 | KAFKA_APIVERSIONS_DISCONNECT | KAFKA_APIVERSIONS_REMOTE_DISCONNECT | 0 | HIGH |
| `r2-trust-service-b2-1785884610777` | 2 | trust-service | 2 | KAFKA_INVALID_RESPONSE | KAFKA_INVALID_RESPONSE | 0 | HIGH |
| `r3-ollama-gateway-b2-1785889154836` | 3 | ollama-gateway | 2 | KAFKA_INVALID_RESPONSE | KAFKA_INVALID_RESPONSE | 1 | HIGH |
| `r3-shopping-service-b0-1785888363316` | 3 | shopping-service | 0 | KAFKA_APIVERSIONS_DISCONNECT | KAFKA_APIVERSIONS_REMOTE_DISCONNECT | 0 | HIGH |

Readiness causation is **not claimed**. Alternatives are listed per row in the JSON.

