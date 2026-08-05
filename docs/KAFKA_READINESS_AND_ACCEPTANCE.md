# Kafka readiness and acceptance

## Classification

**`HARDENING_CANDIDATE_NOT_CAUSAL_REMEDIATION`**

The persistent readiness agent may eliminate expensive JVM-per-kubelet-probe
behavior. It is **not** accepted as the root-cause repair for the five
baseline failures in
`/tmp/record-platform-gate5-pre-v10-current-probe-baseline-v1`.

From that sealed baseline:

- `CURRENT_JVM_PROBE_CAUSALITY = NOT_SUPPORTED` (overlap failure rates do not
  rise with probe overlap).
- `KAFKA_2_LOCALITY_SIGNAL = SUPPORTED_NOT_CAUSAL` (4/5 failures on kafka-2;
  4/36 vs 0/36 vs 1/36). Small-n; not a defect proof.

Do not describe the agent as “the fix” for those five rows.

## Problem

The live KRaft StatefulSet readiness probe cold-starts a JVM
(`kafka-broker-api-versions`) on every kubelet invoke. Gate 5 pre-v10
measurements show multi-second median latency and overlap with workload
windows. TCP-only probes are forbidden: INTERNAL `:9093` requires mTLS and
authenticated Kafka protocol checks.

## Replacement architecture

```
┌─────────────────────────────────────────────┐
│ kafka-N pod                                 │
│  ┌──────────────┐    loopback :8099         │
│  │ kafka        │◄── kubelet GET /readyz    │
│  │ (broker)     │                           │
│  └──────┬───────┘                           │
│         │ INTERNAL :9093 mTLS               │
│  ┌──────▼───────────────────────────────┐   │
│  │ kafka-readiness-agent (sidecar)      │   │
│  │  poll 5s: ApiVersions + Metadata     │   │
│  │  one franz-go client, reconnect      │   │
│  │  /livez /readyz /status /metrics     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

Implementation: `services/kafka-readiness-agent/`  
Contract: `reports/kafka/gate5-pre-v10-readiness-agent-contract.json`  
Future manifests: `infra/k8s/kafka-kraft-metallb/readiness-agent/`

### READY predicates

READY only when **all** hold:

1. Last successful check newer than `FRESHNESS_THRESHOLD` (default **30s**)
2. Metadata includes expected local `NODE_ID` (POD ordinal)
3. TLS OK: chain (leaf→intermediate→root), HTTPS hostname/SNI, client identity
4. Not stuck reconnecting past `RECONNECT_GRACE` (default **60s**)

### Reason codes

| Code | Meaning |
|------|---------|
| `TLS_CHAIN_FAILURE` | Broker chain / EKU / unknown authority |
| `TLS_HOSTNAME_FAILURE` | SNI / DNS SAN mismatch |
| `TLS_CLIENT_IDENTITY_FAILURE` | Missing/invalid client cert/key |
| `TCP_CONNECT_FAILURE` | Dial / connect failure |
| `APIVERSIONS_FAILURE` | ApiVersions error / malformed / disconnect |
| `METADATA_FAILURE` | Metadata error / timeout |
| `LOCAL_NODE_ID_MISMATCH` | Expected node id absent from Metadata |
| `STALE_LAST_SUCCESS` | Success older than freshness threshold |
| `AGENT_INTERNAL_FAILURE` | Agent bug / stuck reconnect / unexpected |

### Forbidden behaviors

- No JVM spawn per probe
- No TCP-only readiness
- HTTP bind loopback only (`127.0.0.1`)
- No secrets in logs or `/status`
- `/readyz` must not create new protocol clients (reuse background poller state)
- Do **not** modify `infra/k8s/kafka-kraft-metallb/statefulset.yaml` until A/B passes
- Do **not** apply readiness-agent manifests to the live cluster until authorized
- Do **not** create `/tmp/record-platform-runtime-heartbeat-gate5-v10`

## A/B gate

Before any live StatefulSet change:

| Cohort | Probe |
|--------|--------|
| **A (current)** | JVM exec `kafka-broker-api-versions` (unchanged) |
| **B (candidate)** | Sidecar HTTP `127.0.0.1:8099/readyz` |

Pass criteria (minimum):

- B ready success rate ≥ A (no material flap regression)
- B probe latency p95 ≪ A (target sub-second HTTP; background check separate)
- No increase in broker produce/consume error rate attributable to B
- Broker JVM CPU/RSS during probe windows not worse under B
- Reason codes observable and bounded

Mark manifests `DO_NOT_APPLY_UNTIL_AB_PASSES` until this gate clears.

## Live rollout requirements

1. A/B gate **PASS** with archived evidence under `reports/kafka/`
2. Explicit authorization to edit `statefulset.yaml`
3. JKS→PEM conversion path validated (`scripts/kafka-readiness-jks-to-pem.sh`)
4. Image built/pushed for `kafka-readiness-agent`
5. Roll one broker at a time; confirm `/readyz` + Metadata node id
6. Keep liveness as TCP `:9093` unless separately redesigned
7. Rollback = restore JVM exec probe from git history of `statefulset.yaml`

## TLS material

| Mode | Env |
|------|-----|
| PEM (preferred) | `TLS_CERT_FILE`, `TLS_KEY_FILE`, `TLS_CA_FILE` |
| Keystore | `KEYSTORE_PATH` / `TRUSTSTORE_PATH` as PEM or PKCS12 + passwords |

Broker pods today mount JKS at `/etc/kafka/secrets`. Convert with init container;
do not require Go to parse JKS.

## Acceptance checklist

- [x] Go module + unit tests (`go test ./...`)
- [x] Contract JSON published
- [x] Future k8s manifests marked do-not-apply
- [x] Live `statefulset.yaml` unmodified
- [ ] A/B comparison executed
- [ ] Live rollout authorized
- [ ] Gate 5 final pass / Gate 6 authorization (separate)
