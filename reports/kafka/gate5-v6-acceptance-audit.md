# Gate 5 v6 acceptance audit

**Classification: `FUNCTIONAL_PASS_EVIDENCE_INCOMPLETE`**

Do not infer evidence-complete PASS from the frozen marker alone.

## Integrity

| Field | Value |
|---|---|
| v6 root | `/tmp/record-platform-runtime-heartbeat-gate5-v6` |
| terminal marker | `FROZEN_PASS_EVIDENCE` |
| marker SHA-256 | `6fb1a01c78de93cbcc5a5686bbd50b45b231bfd5cc90e7b78703a8b67d95898b` |
| manifest SHA-256 | `a92ccaf2291f87b40d89ffd2e402593162f752ad4b2955f9c12f4bf5c62be086` |
| tree SHA-256 | `48fd48fb4f000a748b3f9651b98d6ff648b963d582bbe3ca7a4b53b684a0e437` |
| files / bytes | 26 / 85058 |
| exact source SHA | `cc627dac49b20c83342d41071ac2fa484255969c` |
| immutable | confirmed (audit did not mutate v6) |

## CI

| Metric | Value |
|---|---|
| required expected/passed/failed | 8/7/1 |
| kafka-dns-validate | **REQUIRED_AND_FAILED** |
| universally green | **false** |

Failure: missing tracked `jaeger-query-metallb.yaml` in kustomize offline validation (run 30684087087).

## EKU and chains (from v6 artifacts only)

| Metric | Value |
|---|---|
| roles expected | 19 |
| roles with mounted fingerprint copies in v6 | 19 |
| roles with clientAuth EKU on those copies | 19 |
| roles with broker-observed presentation | **0** |
| brokers with serverAuth runtime proof in v6 | **0** |

Mounted shared-leaf fingerprint ≠ per-role broker presentation proof.

## Broker positive

| Op | expected/tested/passed |
|---|---|
| metadata | 3/3/3 |
| produce | **3/0/0** |
| consume | **3/0/0** |

## Broker negatives (8×3=24)

Only MISSING_CLIENT_CERTIFICATE and PLAINTEXT were partially tested (not 3/3 each). Six categories absent.

## Topics

21 expected / 22 discovered. Extra `gate5.v2.probe` → **ACCEPTANCE_EPHEMERAL_TOPIC** (stale_test_topics=1 until deleted/excluded).

## Events

Marker-only transport proof on `gate5.v2.probe`. **0** business event-family lineage rows.

## Stability / observability

900s observation present; group rebalance denominators absent; SIGTERM absent; pcaps=0; MetalLB Jaeger exact traces=0.

## Decision

- **v6 classification:** `FUNCTIONAL_PASS_EVIDENCE_INCOMPLETE`
- **gate5-v7 required:** true
- **Gate 6 authorized:** false
- **performance authorized:** false
- **production approved:** false

Preserve v6 forever. Backfill only on a fresh gate5-v7 after harness/source remediation (including CI).
