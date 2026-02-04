# ADR-003: MetalLB Investigation and Integration (beyond HAProxy / RR)

**Status:** Investigation / Planning  
**Date:** 2026-02  
**Context:** Record Platform uses HAProxy for load balancing and keep-alive pools. Round-robin (RR) and current NodePort/host setups have limitations (e.g. no L2/L3 LB for bare-metal or certain K8s topologies, no LoadBalancer service type). This ADR captures investigation and a plan to incorporate MetalLB on top of the existing stack.

## Current state

- **HAProxy** (`infra/haproxy/`, K8s base): Keep-alive pools, load balancing to API Gateway.
- **NodePort**: Caddy (30443), Envoy, ingress; external access via node IP + port.
- **RR limitations**: Single-node Kind/Colima; no real L2/L3 LoadBalancer; port exhaustion with many NodePorts; no BGP or L2 advertisement for “real” LoadBalancer IPs.

## Goals

- Understand **MetalLB** (L2 and/or BGP mode) and how it fits with existing Caddy/Envoy/ingress and HAProxy.
- Produce an **artifact**: investigation summary, UML (or Mermaid) diagram of current vs proposed traffic path, and an **integration plan** (steps, ordering, rollback) to add MetalLB without breaking current flows.

## Investigation deliverables

1. **Limitation summary**
   - Document RR/NodePort limitations in current dev and in a hypothetical multi-node or bare-metal deployment.
   - When would MetalLB be required vs nice-to-have?

2. **MetalLB overview**
   - L2 mode: ARP/NDP, single IP per service, failover.
   - BGP mode: Multi-node, ECMP; requirements (BGP router, peer config).
   - Compatibility: Kind, Colima, minikube, cloud (where MetalLB is usually not used).

3. **UML / diagram (artifact)**

   **Current flow (NodePort / RR):**
   ```mermaid
   flowchart LR
     Client -->|":30443 NodePort"| Caddy
     Client -->|":10000 NodePort"| Envoy
     Caddy --> ingress[ingress-nginx]
     Envoy --> ingress
     ingress --> Nginx[Nginx Edge]
     ingress --> Gateway[API Gateway]
     Nginx --> HAProxy[HAProxy]
     HAProxy --> Gateway
     Gateway --> Services[Microservices]
   ```

   **Proposed flow (MetalLB LoadBalancer):**
   ```mermaid
   flowchart LR
     Client -->|"LB IP:443"| MetalLB[MetalLB L2]
     MetalLB --> Caddy
     MetalLB --> Envoy
     Caddy --> ingress[ingress-nginx]
     Envoy --> ingress
     ingress --> Nginx[Nginx Edge]
     ingress --> Gateway[API Gateway]
     Nginx --> HAProxy[HAProxy]
     HAProxy --> Gateway
     Gateway --> Services[Microservices]
   ```

   Components: MetalLB controller + speaker(s), Service `type: LoadBalancer` with pool annotation, existing Caddy/Envoy/HAProxy unchanged behind ingress.

4. **Integration plan (XML or structured outline)**
   - Prerequisites (K8s version, network plugin, IP range for L2).
   - Install steps (Helm or manifest).
   - Change to Caddy/Envoy/ingress Services: switch to or add `type: LoadBalancer` and MetalLB annotation/address pool.
   - HAProxy: keep as-is or adjust upstream to new LB IPs.
   - Validation: curl to LoadBalancer IP, then run preflight/suites.
   - Rollback: revert Service types, uninstall MetalLB.

## Decisions (to be made)

- [ ] MetalLB L2 only vs BGP (L2 sufficient for single-site/dev).
- [ ] Which services get LoadBalancer first (e.g. Caddy only, or Caddy + Envoy).
- [ ] IP pool and conflict with existing NodePort usage.

## Next steps

- Implement the diagram (Mermaid in this doc or separate `.mmd`/exported image).
- Add a short “MetalLB integration” section to Runbook or ENGINEERING.md once the plan is approved.
