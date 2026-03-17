# Real asymmetric routing on Colima k3s — plan

**Goal:** Test MetalLB with **real asymmetric routing** (two distinct node→LB paths). On Colima k3s this requires **2+ nodes** so traffic from node A and node B to the LoadBalancer IP takes two different paths; verification then confirms both paths return 200.

## Current state (single node)

- **Single-node Colima:** `verify-metallb-advanced.sh` step 4 reports: "Single-node Colima: host path and node (hostNetwork) path both 200; add second node for real asymmetric (two node→LB paths)."
- Real asymmetric = **two distinct node→LB paths**; with one node there is only one path (host and hostNetwork pod share the same node).

## How to test real asymmetric properly

### Option A: Add a second Colima node (multi-node Colima)

1. **Add a second node to Colima k3s** (if Colima supports multi-node worker; check `colima start --help` and docs for adding workers).
2. Ensure MetalLB pool (e.g. `192.168.5.240-192.168.5.250`) is reachable from **both** nodes (same L2 or routed).
3. Run `./scripts/verify-metallb-and-traffic-policy.sh` (with `SKIP_METALLB_ADVANCED=0`). Step 4 (asymmetric) will:
   - Create two pods with `hostNetwork: true`, one on each node.
   - Each pod curls the LB IP. Both must return 200 for "Real asymmetric OK: LB IP reachable from node A and node B — two distinct node→LB paths."

**Caveat:** Colima’s default setup is single-VM; multi-node may require a different layout (e.g. multiple VMs or a different local cluster tool).

### Option B: Use k3d for asymmetric (2 nodes), Colima for L2/BGP

- Run preflight/suites on **k3d** with 2 nodes (`PREFLIGHT_K3D_EXPECTED_NODES=2`). Step 3c1b runs MetalLB verify on k3d; step 4 (asymmetric) will run two hostNetwork pods on the two k3d nodes.
- k3d nodes share Docker network; MetalLB pool (e.g. `192.168.106.240-192.168.106.250`) is typically given a route on each node so pods can reach the LB IP. Then "full asymmetric" (two node→LB paths) can pass.
- Colima remains the place for **real L2/ARP/BGP** when `METALLB_VERIFY_COLIMA_L2=1` (step 3c1c); asymmetric there stays "single node" until Colima has 2+ nodes.

### Option C: Document as “N/A until 2+ nodes”

- In the advanced script, step 4 already says: "Real asymmetric = two distinct node→LB paths; add a second node to test."
- No code change; treat real asymmetric as **verified only when 2+ nodes** (k3d or future multi-node Colima).

## Recommendation

- **Today:** Use **Option C** — keep the current message; run full verify on Colima for L2 + BGP + single-node path check. For a full asymmetric test, use **Option B** (k3d with 2 nodes and MetalLB) or add a second node to Colima when supported.
- **Later:** If Colima gains multi-node or you switch to a 2-node bare-metal/VM cluster, re-run verify with 2 nodes; step 4 will then report "Real asymmetric OK" when both node paths return 200.

## Verification commands

- Full MetalLB (including BGP and asymmetric message):  
  `./scripts/verify-metallb-and-traffic-policy.sh`
- Skip advanced (faster):  
  `SKIP_METALLB_ADVANCED=1 ./scripts/verify-metallb-and-traffic-policy.sh`
- BGP session:  
  `kubectl -n metallb-system logs -l app=metallb,component=speaker --tail=50 | grep -i bgp`
