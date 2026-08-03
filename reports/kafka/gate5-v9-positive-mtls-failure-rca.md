# Gate 5 v9 positive-mTLS failure RCA

**Verdict:** Platform failure preserved (`POSITIVE_MTLS_ROW_FAILED`). OpenSSL chain success is not Kafka protocol success. Root cause class: **BROKER_READINESS_FALSE_POSITIVE** (TCP-only Ready) plus original-row causal evidence gap. Failure **not reproduced** in later 20/20 kafka-0 rows — that is not remediation. **v10 not created.**

## Preserved v9

| Item | Value |
|------|--------|
| Terminal | `FROZEN_BLOCKED_EVIDENCE` |
| Files / bytes | 26 / 203017 |
| Freeze SHA-256 | `492ecea2a0e7817a1de49334ff6ba6161576c0347c83a62391352162288881a1` |
| Mutated after freeze | false |
| Rows retried / importable to v10 | 0 / false |
| External RCA root | `/tmp/record-platform-gate5-v9-positive-mtls-rca-v1/` |

## Failed row

- **analytics-service × kafka-0** (controls kafka-1/2 PASS)
- Matrix: **36/36/35/1**
- Client leaf: `1C:59:F6:…:B2:EE` · Broker leaf: `96:3C:D6:…:D9:04`
- Chain / hostname fields OK; `pass=false` because ApiVersions acceptance predicate failed
- **ORIGINAL_ROW_CAUSAL_LAYER = INSUFFICIENT_EVIDENCE** (no kafka stdout/stderr/exit retained)
- **exact_original_exception = null**

## Reproducer and repetition (outside v9)

Direct endpoint only: `kafka-{n}.kafka.record-platform.svc.cluster.local:9093`

| Check | Result |
|-------|--------|
| Staged DNS→TCP→TLS→ApiVersions→metadata→describe (kafka-0) | PASS |
| kafka-0 repetition | **20/20/20/0** |
| kafka-1 control | **5/5/5/0** |
| kafka-2 control | **5/5/5/0** |
| Config differences (unexpected) | **0** (podIP only) |
| Packet captures expected/present | **3/0** |

Interpretation: intermittent/readiness-class risk, not proven kafka-0-only config/PKI defect.

## Readiness

At failure, readiness was **`tcpSocket:9093` only** → Kubernetes Ready does not prove authenticated ApiVersions.

Remediation: StatefulSet readiness exec runs `kafka-broker-api-versions` with mounted JKS, `security.protocol=SSL`, `ssl.endpoint.identification.algorithm=HTTPS`. Regression: `tests/gate5-kafka-readiness-not-tcp-only.test.mjs`.

## Twelve questions

1. Original Kafka TLS complete? **Unknown** (later: yes).
2. Client cert kafka-0 received? **Inferred** exclusive keystore FP above.
3. Server cert client received? **Broker leaf FP** above (OpenSSL path).
4. Hostname verify on Kafka client path? **OpenSSL yes**; Kafka path not evidenced on failure.
5. ApiVersions reached kafka-0? **Unknown** original; **yes** later 20/20.
6. kafka-0 Kafka response? **Unknown** original; **yes** later.
7. StandardAuthorizer initialized? Present in config all brokers; original window unproven.
8. Registered / metadata serving? **Yes** at RCA; original unknown.
9. Deterministic vs intermittent? **Not reproduced** → intermittent/readiness class.
10. Why 1/2 passed? Same identity/config; kafka-0 often slower ApiVersions.
11. Remediation? Authenticated ApiVersions readiness + harness causal capture.
12. Regression? `tests/gate5-kafka-readiness-not-tcp-only.test.mjs`.

## Status gates

`v10_created=false` · `gate5_final_pass=false` · `gate6_authorized=false` · `production_approved=false`
