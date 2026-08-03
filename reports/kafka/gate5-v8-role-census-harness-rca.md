# Gate 5 v8 role-census harness RCA

## Classification

| Field | Value |
|-------|-------|
| Evidence root | `/tmp/record-platform-runtime-heartbeat-gate5-v8/` |
| Terminal state | `FROZEN_BLOCKED_EVIDENCE` |
| Recorded failure | `ROLE_CENSUS_MISMATCH` |
| Refined | `HARNESS_ROLE_IDENTITY_KEY_BUG` |
| Platform failure | **false** |
| Harness failure | **true** |

Completed v8 rows are **`HISTORICAL_FUNCTIONAL_EVIDENCE_NOT_FINAL_GATE5_ACCEPTANCE`**.
Do not import them into a future PASS denominator. Do not reopen v8.

## Defect

The census required the **bare role suffix** (`producer`, `consumer`, …) to be globally unique.
That is invalid: suffixes legitimately repeat across services.

Correct model:

1. **Role suffix** — descriptive; may repeat.
2. **Contract role identity** — `<service>:<role>` / `required_client_id_form`; unique in contract.
3. **Observed live client ID** — `record-platform.<service>.<pod-token>.<role>`; unique among concurrent clients.

Kafka authorization remains TLS certificate principal + ACL only. Client ID is attribution.

## Preservation

- Marker sha256: `cae2225463c0c550894ea4f3916242d31f7084db12ebfb4ed9e7234d6e03c301`
- HARD_FAILURE sha256: `4cf076c9f5aa41fc8204d9997bacb6cdd27294a04fd9395b981db1b1b8e1391e`
- Files/bytes (at index): 67 / 640816

## Remediation

- Module: `scripts/lib/gate5_role_census.py`
- Tests: `tests/gate5-role-census.test.mjs`
- Next: Gate 5 v9 only after harness-only CI green and runtime carry-forward/revalidation.
