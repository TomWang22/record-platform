# ADR 011: Colima k3s as Primary Cluster Again (Move Back from k3d)

**Status:** Accepted  
**Date:** 2026-02-20  
**Context:** ADR 009 and ADR 010 established **k3d** as the default local cluster for preflight and test suites, with Colima k3s used only optionally for MetalLB L2 verification (step 3c1c). We have since moved **Colima k3s** back to the primary path for local development and preflight.

## Context

- **k3d as primary (ADR 009/010)** was chosen to avoid Colima control-plane overload, tunnel flakiness (6443), and to give CI/local a lighter, reproducible path. MetalLB on k3d required socat + loopback alias for host→LB IP; real L2/ARP/asymmetric were only available on Colima via an isolated step (3c1c).
- In practice we needed **real MetalLB behaviour** (L2, ARP, asymmetric, hairpin) and **HTTP/3 over the LB IP** from the host for strict TLS and protocol verification. On k3d, the LB IP is in the Docker network and host reachability is via socat; QUIC through that path is brittle on macOS (GSO, UDP, exit 7/28). Colima with **bridged** networking puts the MetalLB pool on the VM’s LAN segment; with a **one-time host route** the Mac can reach the LB IP directly and HTTP/3 (QUIC) works without socat.
- Control-plane stability on Colima was addressed: **native API port** (no 6443 tunnel in pipeline), **etcd/k3s tuning** (ADR 006, CONSERVATIVE=1), **rate-limited applies**, and **colima-fix-control-plane-for-good** for crash-loop recovery. With those in place, Colima k3s is stable enough to be the primary cluster for full preflight and suites.

## Decision

1. **Colima k3s is the primary cluster** for preflight and test suites when running locally. Use `REQUIRE_COLIMA=1` (default) and ensure Colima is running with bridged networking (`colima-start-k3s-bridged-clean.sh` or equivalent). Preflight installs MetalLB, verifies LB IP reachability, and runs all suites (auth, baseline, enhanced, adversarial, rotation, k6, standalone, tls-mtls, social) on Colima.

2. **One-time host route for HTTP/3 via LB IP:** On Colima bridged, the Mac is not on the MetalLB subnet. Add a route so the host can reach the pool. Use the node’s **IPv4** address only (InternalIP can be IPv6; macOS `route` will fail with "bad address" otherwise). Example: `NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1); [[ -n "$NODE_IP" ]] && sudo route -n add 192.168.5.0/24 "$NODE_IP"`. Or use a known IPv4 from `kubectl get nodes -o wide`: `sudo route -n add 192.168.5.0/24 <colima_node_ipv4>`. MetalLB verify then sees the LB IP as reachable and writes `REACHABLE_LB_IP` and `PORT=443` to `/tmp/metallb-reachable.env`; run-all and suites use the LB IP for HTTP/2 and HTTP/3, and strict TLS/mTLS and packet capture all use that target.

3. **k3d remains supported** with `REQUIRE_COLIMA=0`. Use it for CI or when Colima is not desired; in-cluster Caddy verify and NodePort/socat path for LB IP still apply (see ADR 009, 010).

4. **Real L2/ARP/asymmetric on Colima:** MetalLB advanced verification no longer “simulates” ARP on Colima; it reports **real L2 / real ARP** and prints the path (host→LB via route, in-VM bridge). Asymmetric and hairpin tests use hostNetwork where needed and treat Colima-specific failures as info when the host path is already verified.

## Rationale

| Concern | Colima primary | k3d fallback |
|--------|----------------|--------------|
| **Real MetalLB** | L2, ARP, asymmetric, hairpin on real VM network | L2 in Docker; real behaviour only via optional Colima step |
| **HTTP/3 from host** | One-time route → LB IP:443 → QUIC works; no socat | Socat UDP 443 on host; QUIC often fails (GSO, timeout) |
| **Control plane** | Stabilized (native port, tuning, fix-control-plane script) | Stable but not used as default for full preflight |
| **Strict TLS + LB IP** | Single path: CA cert, --http3-only, traffic target LB IP | Same policy; NodePort/socat when LB IP unreachable |

## Consequences

- Default preflight and suite runs target Colima k3s; document the one-time route in RUN-PREFLIGHT.md and Runbook (item 68).
- Runbook, ENGINEERING.md, and script headers describe Colima as primary and k3d as optional (REQUIRE_COLIMA=0).
- ADR 009 and 010 are not reversed: k3d remains the **supported alternative**; this ADR changes the **default** back to Colima k3s and records the rationale.

## References

- **ADR 006** — Colima k3s etcd tuning.
- **ADR 008** — Multi-node required; MetalLB valid.
- **ADR 009** — k3d as default local cluster (now alternative).
- **ADR 010** — k3d primary; Colima L2 isolated (now Colima primary).
- **Runbook.md** — Items 68–74 (route, real L2/ARP, hairpin, multi-subnet, HTTP/3 only, suite policy, this ADR).
- **scripts/RUN-PREFLIGHT.md** — Colima + MetalLB one-time route.
