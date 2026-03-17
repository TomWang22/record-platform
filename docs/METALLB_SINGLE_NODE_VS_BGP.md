# MetalLB: Single-Node Stable vs BGP (Chaos) Profile

## Two profiles

| Profile | When to use | What runs | QUIC after speaker churn |
|--------|-------------|-----------|---------------------------|
| **Single-node stable (L2 only)** | Colima single-node; daily dev; stable HTTP/3 | IPAddressPool + L2Advertisement only | Stable |
| **Multi-node / BGP (chaos)** | Multi-node cluster; external BGP router; stress/ECMP testing | IPAddressPool + L2Advertisement + BGPPeer + BGPAdvertisement | Unstable until L2/BGP converge (~15–20 s) |

On **single-node Colima** you do not gain anything from BGP: no second node, no ECMP, no external router. The same IP (e.g. 192.168.5.240) is then advertised **twice** (ARP + BGP) from the same speaker. That creates micro-instability after speaker restart: QUIC can fail with `ERR_HANDSHAKE_TIMEOUT` until ARP/BGP reconverge; TCP survives because it retries.

---

## Single-node stable (L2 only)

**Goal:** Stable QUIC on single-node Colima. One advertisement path (ARP). No BGP reconvergence.

### New install (default)

```bash
# L2-only is now the default (METALLB_L2_ONLY=1)
./scripts/install-metallb-colima.sh
```

No BGP is installed. LB IP works via L2 (ARP) only.

### Existing cluster (already has BGP)

Switch to L2-only without reinstalling MetalLB:

```bash
./scripts/metallb-colima-l2-only.sh
```

This deletes all `BGPAdvertisement` and `BGPPeer` in `metallb-system`. Pool and L2Advertisement stay. FRR can stay running; MetalLB simply no longer advertises via BGP.

**Optional:** Remove FRR if you don’t need it at all:

```bash
kubectl -n metallb-system delete deploy frr
```

### Verify

```bash
./scripts/verify-metallb-and-traffic-policy.sh
```

Use `SKIP_METALLB_ADVANCED=1` to skip route-flap/BGP stress. HTTP/3 should remain stable.

---

## Multi-node / BGP (chaos) profile

**Goal:** Multi-node, external BGP router, or stress-testing L2+BGP convergence and route flaps.

### When to use

- Multi-node cluster and you need BGP for path control or ECMP.
- Real external router that peers with MetalLB.
- You explicitly want to test: speaker restart, ARP/BGP reconvergence, QUIC sensitivity.

### Enable BGP

**On a fresh install:**

```bash
METALLB_L2_ONLY=0 ./scripts/install-metallb-colima.sh
```

**On an existing L2-only cluster:**

```bash
./scripts/install-metallb-frr-bgp.sh
```

That deploys FRR and applies BGPPeer + BGPAdvertisement. The same pool is now advertised via L2 and BGP.

### What to expect

- **Steady state:** HTTP/1.1, HTTP/2, HTTP/3 all work.
- **After speaker restart (e.g. advanced verify route-flap test):** QUIC can fail with `ERR_HANDSHAKE_TIMEOUT` for 15–20 s until L2/BGP converge. TCP/HTTP/1.1/HTTP/2 keep working.
- **Full verify:** Run `./scripts/verify-metallb-and-traffic-policy.sh` (with or without advanced). For a quick pass without stress, use `SKIP_METALLB_ADVANCED=1`.

---

## Verification: stable vs chaos mode

The verify script treats the two profiles differently:

| Mode | When | Step 6a (all three protocols) | HTTP/3 |
|------|------|--------------------------------|--------|
| **Stable** | `SKIP_METALLB_ADVANCED=1` | Runs once before advanced (skipped). Single probe. | Must pass immediately. |
| **Chaos** | Advanced runs (route flap, ARP sim, multi-pool) | Runs **after** advanced. | Convergence retries: up to 10 attempts, 3 s apart (~30 s). Only fails if QUIC does not recover in that window. |

- **Stable:** No route flap, no ARP sim, no multi-pool. A single `curl --http3-only` is enough; QUIC must always pass.
- **Chaos:** Speaker restart and other churn cause brief QUIC fragility (even with L2-only). A single immediate HTTP/3 probe after churn is too strict. The script therefore retries HTTP/3 for up to ~30 s and only reports failure if it never recovers. This matches real expectations: QUIC is more sensitive than TCP to first-packet loss and neighbor-table churn.

In the advanced script, after deleting the speaker pod the script waits for the pod to be fully removed (`kubectl wait --for=delete pod/... --timeout=60s`) before the 15 s recovery sleep, so ARP withdrawal is clean and convergence timing is more predictable.

---

## Summary

- **Single-node Colima, stable QUIC:** Use L2-only (default install or `./scripts/metallb-colima-l2-only.sh`). Tests don’t fight convergence.
- **Multi-node or BGP/chaos testing:** Use `METALLB_L2_ONLY=0` or `install-metallb-frr-bgp.sh`. Accept QUIC instability during convergence after speaker churn; see `docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md` §5b.
