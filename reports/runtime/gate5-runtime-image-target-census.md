# Gate 5 runtime image-target census

`runtime_carry_forward_from_f99868f1 = false`

| Denominator | Raw |
|---|---|
| source_built_image_targets expected/discovered | **16/16** |
| kafka_workloads expected/discovered | **12/12** |
| kafka_pods expected | **13** (incl. 2 ollama-worker replicas) |
| logical_roles expected/discovered | **19/19** |

## Why 19 (not v1’s 15)

v1 conflated outbox publishers into `producer` and used a single `.consumer` suffix for lifecycle + notification. Remediation assigns one explicit role per separately constructed Kafka client, including `outbox-publisher`, `notification-consumer`, `lifecycle-consumer`, `market-event-consumer`, and `inference-consumer`.

Ollama gateway/workers are now source-built image targets and exact-SHA pin members.
