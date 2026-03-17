# ADR 008: Multi-Node Required; MetalLB Valid Infra

**Status:** Accepted

## Context

Single-node Colima/k3s cannot sustain burst applies (cert reissue, MetalLB, full preflight). Tuning and chunked apply were tried; 503 and flakiness persist. MetalLB install fails on single-node not because MetalLB is broken but because the control plane is overloaded.

## Decision

1. **Infra validation moves to multi-node.** Two nodes minimum for: cert reissue, MetalLB, full preflight. Three nodes optional for headroom / future HA.

2. **Order of operations is non-negotiable:** Bring up 2-node cluster → verify API stability → apply API server tuning → deploy platform workloads → only then install MetalLB → then run full preflight / k6 / pgbench. Violations: failures expected and ignored.

3. **Default path:** k3d, same host, 2 nodes (1 server + 1 agent). Colima or multi-VM only when VM realism or host networking testing is explicitly needed.

4. **MetalLB status:** MetalLB is **valid infra**, blocked only by single-node control plane limits. L2 mode first; HAProxy + ingress unchanged; LoadBalancer only at the edge; clear rollback. On 2 nodes it applies cleanly; chunked installer becomes optional. If it fails on 2 nodes, then it is a MetalLB problem.

## Consequences

- Single-node is no longer the target for cert reissue, MetalLB, or full preflight.
- All new validation and handoff docs assume 2-node minimum and the fixed order.
- One handoff doc: `docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`.
