# Gate 5 v7 — harness false-pass RCA

**Frozen root:** `/tmp/record-platform-runtime-heartbeat-gate5-v7/`  
**Classification:** `HARNESS_FALSE_PASS_RISK` / `FROZEN_BLOCKED_EVIDENCE`  
**Source SHA at freeze:** `c800ac5313ea8fb88a59f08c7347103ba1d4ed19`

## Preserved evidence

```text
positive_mtls_expected/tested/passed/failed = 36/36/36/0
```

Do **not** convert this root to PASS after repair. Create **gate5-v8** after the corrected harness lands.

## Hard-failure reasons

1. EKU/SPIFFE assertion contains `|| true` (always passes).
2. Source tests check field names that do not match the measured report (`eku_clientAuth`, `eku_serverAuth`, `sans`).
3. `RP_GATE5_V7_ACL_PRUNE=1` is advertised but performs no pruning.
4. Live ACL verification checks expected-subset presence, not exact set equality.
5. Human `kafka-acls --list` proximity parsing can cross-associate ACL blocks.
6. Unexpected, duplicate, DENY, stale, host, permission-type, and resource-pattern drift are not completely rejected.
7. Application super-user source parsing is not YAML/env-structure aware.
8. Full 19-role authorization contract is not represented in source tests.
9. Truststore imports `ca-chain.pem` under a single alias.
10. Kafka CLI calls lack strict timeouts; mutable evidence is written into `reports/kafka/`.

## Required repair

- Structural StatefulSet env parsing for authorizer/super.users.
- Exact normalized `AclBinding` set comparison (AdminClient JSON).
- Honest prune mode (reconcile or remove).
- 19 logical roles from the identity contract.
- Separate root/intermediate trust aliases.
- Bounded timeouts + single-writer lock.
- Raw evidence under `/tmp`; sanitized summaries only in Git.

`DUAL_USE_EKU_ACCEPTED_EXCEPTION` remains in force — no per-node broker identity claims.

## Remediation status (harness)

| Defect | Status |
|--------|--------|
| EKU/SPIFFE `\|\| true` | Fixed in `tests/gate5-v7-fail-closed-authorizer.test.mjs` |
| Subset / proximity ACL verify | Replaced by AdminClient + exact set compare |
| Prune no-op | Exact reconciliation when `RP_GATE5_V7_ACL_PRUNE=1` |
| Super-users line-split | Structural env parse in authorizer-verify + bootstrap |
| 12 vs 19 roles | Source test asserts 19 `logical_roles` |
| Truststore single alias | `record-platform-root` + `record-platform-intermediate` |
| Unbounded CLI / mutable Git evidence | Timeouts + `/tmp` evidence root + summary JSON |

**gate5-v7 root remains `FROZEN_BLOCKED_EVIDENCE`.** Do not convert to PASS.
