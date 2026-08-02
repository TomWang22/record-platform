# Gate 5 v7 — controller / three-plane mTLS design

**Status: DESIGN ONLY — not applied. Authorizer not enabled.**

## Current (not fully strict)

| Listener | Port | client.auth | Notes |
|---|---|---|---|
| INTERNAL | 9093 | required | clients + inter-broker |
| EXTERNAL | 9094 | required | MetalLB external |
| CONTROLLER | 9095 | **none** | quorum; TLS without client certs |

The platform must not claim fully strict Kafka mTLS while CONTROLLER accepts TLS without client authentication.

## Broker certificate

Classification: `DUAL_USE_EKU_REQUIRED_WITH_RATIONALE`

One keystore serves server + inter-broker client roles. Splitting to serverAuth-only / clientAuth-only requires listener-specific keystores before CONTROLLER clientAuth=required.

## Target before Gate 5 v7

- CONTROLLER clientAuth=required on kafka-0/1/2
- Measured controller principals
- Rollback + quorum health gates
- Then authorizer fail-closed rollout
