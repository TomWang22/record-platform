# MetalLB advanced verification

When you run preflight with **METALLB_ENABLED=1** (e.g. `METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh`), the MetalLB verification runs the **thorough suite** and then by default the **advanced** checks below.

## Environment (k3d vs Colima vs bare metal)

The script infers environment from your kubectl context and labels it clearly:

- **k3d (Docker)** — Context name contains `k3d`. Nodes run in Docker; the host typically reaches the LB IP via a loopback alias + socat. Pods/nodes often have no route to the MetalLB pool from inside the cluster. ARP and full asymmetric tests are informational (GARP from a pod doesn’t affect the host; dual-node curl often returns 000).
- **Colima** — Context contains `colima`. VM-based; real L2 to the LB IP may be possible, so ARP and asymmetric tests can be meaningful.
- **cluster (bare metal or other)** — Any other context. Treated as bare metal or similar; L2 and dual-path tests apply as normal.

## What runs by default

After `verify-metallb-and-traffic-policy.sh` (steps 1–6a), the script invokes **verify-metallb-advanced.sh**, which runs:

1. **BGP mode (vs L2)**  
   - If BGPPeer CRs exist, reports BGP mode and BGPAdvertisement, then **verifies BGP is actually working** by checking speaker logs for session-established indicators (e.g. `established`, `session up`). If found: "BGP session(s) established". If not: "BGP configured; no session-up in speaker logs (is BGP router reachable?)".  
   - If no BGPPeer, reports L2 only. Full BGP verification requires a BGP router (e.g. FRR) peering with the MetalLB speaker — see "Manual / deeper tests" below.

2. **Route flap injection**  
   - Deletes one MetalLB speaker pod to simulate a route flap, waits 5s, then curls the LB IP.  
   - Confirms the LB IP is still reachable after speaker restart (recovery).

3. **ARP poisoning simulation (L2) — real L2 test when possible**  
   - With L2Advertisement present, the script runs a **real L2 ARP test** when the host reaches the LB IP via a real interface (not loopback): it detects the interface (Linux: `ip route get`; macOS: `route get`), and if not `lo`/`lo0`, sends GARP from the host and checks curl. When the host uses loopback (e.g. k3d), it skips host GARP and reports that. Otherwise it runs an automated ARP test: sends gratuitous ARP (GARP) for the LB IP from the host (if `arping` is available) or from a short-lived pod, then curls the LB IP (traffic may be affected), then waits and verifies recovery (curl 200).  
   - On k3d, the host often uses a **loopback alias + socat** for the LB IP, so the host is not on the pod L2; GARP from a pod then does not affect the host path, and “curl still 200” is expected. The script explains this. On bare metal or Colima with real L2, GARP can affect traffic.  
   - You can force the interface for host GARP with `ARP_TEST_INTERFACE=eth0`. Manual deeper tests (e.g. from another host) are in “Manual tests” below.

4. **Asymmetric routing (full: two nodes)**  
   - Creates two pods with `hostNetwork: true` on two different nodes; each curls the LB IP. Both must return 200 for “full asymmetric” (two distinct source paths).  
   - On **k3d**, the script automatically adds a route on each node (`192.168.106.0/24 dev eth0`) so pods can reach the MetalLB pool. Both nodes should then return 200. Override with `METALLB_POOL_CIDR` if your pool CIDR differs.

5. **Multi-subnet / multi-pool (real test)**  
   - With a single pool: creates a temporary second pool (one IP in CIDR form, e.g. `192.168.106.251/32`, as required by MetalLB), L2Advertisement, a minimal nginx LoadBalancer service using that pool (and optional `loadBalancerIP` to force the IP), then curls the service (on k3d, in-cluster hostNetwork pod first since the host may have no route to the second IP). Cleans up afterward.  
   - With 2+ existing pools: uses the second pool for a temp LoadBalancer and curl.  
   - Verifies the assigned IP is from the intended pool when a temp pool was created.

## Bringing tests to reality (Colima with real L2, BGP, asymmetric)

**Recommended:** Run MetalLB verification on **Colima k3s** for full BGP, L2, and asymmetric tests. k3d is for system testing; Colima with real L2 yields meaningful BGP session, ARP, and dual-path results.

**Run L2-only (ARP + asymmetric) on Colima from preflight:** Use k3d for the main pipeline and Colima for real L2 checks: `METALLB_VERIFY_COLIMA_L2=1` when running preflight with `METALLB_ENABLED=1`. Preflight will switch to the Colima context, run `./scripts/verify-metallb-colima-l2-only.sh` (ARP sim + asymmetric only), then switch back to k3d. Requires a Colima context (e.g. `colima start --with-kubernetes` and MetalLB installed on Colima).

**Standalone Colima L2 verification:** `kubectl config use-context colima` then `./scripts/verify-metallb-colima-l2-only.sh`. This runs only steps 3 (ARP) and 4 (asymmetric) from the advanced script; BGP, route flaps, and multi-subnet are skipped.

On **k3d (Docker)**, several checks are limited: nodes often have no route to the MetalLB pool; the host uses loopback alias + socat; BGP/asymmetric/multi-pool can show 000 or "expected on k3d". To run **real** tests:

- **Colima + k3s with real L2** — Use Colima instead of k3d. Ensure the Colima VM and host share L2 with the MetalLB pool (e.g. bridge networking so MetalLB IPs are routable). Then BGP (with a BGP router), asymmetric routing (dual-node curl), and ARP tests are meaningful.
- **BGP** — Run `./scripts/install-metallb-frr-bgp.sh` to deploy FRR and apply BGPPeer + BGPAdvertisement; re-run verification for "BGP session(s) established". If speaker logs show **connection refused** to the FRR service (e.g. `dial "10.43.x.x:179": connection refused`), the FRR pod likely needs **capabilities NET_ADMIN, NET_RAW, SYS_ADMIN** (see `infra/k8s/metallb/frr-deploy.yaml`); without them, zebra/bgpd fail to start and the pod goes CrashLoopBackOff. Apply the deployment with the securityContext and re-run.
- **HTTP/3 GSO** — On macOS, curl with QUIC can hit `sendmsg() errno 5 (EIO); disable GSO`. Scripts set `NGTCP2_ENABLE_GSO=0` when running HTTP/3 curl. If HTTP/3 still fails, try `brew upgrade curl` (ngtcp2 builds) or use the Docker HTTP/3 image (alpine/curl-http3) which runs Linux.
- **In-VM HTTP/3 (Colima)** — If the verify script reports "HTTP/3 in-VM to LB IP returned 000" (VM curl lacks `--http3-only`), install curl with ngtcp2 in the Colima VM: `colima ssh -- bash -s < scripts/install-curl-http3-colima-vm.sh`. Or use bridged networking so the Mac can curl the LB IP directly (recommended).

## Skipping advanced checks

To run only the basic MetalLB verification (no BGP, route flaps, ARP, asymmetric, multi-subnet):

```bash
SKIP_METALLB_ADVANCED=1 ./scripts/verify-metallb-and-traffic-policy.sh
```

Or from preflight, set the same env when invoking the script (e.g. in the pipeline that calls the verify script).

## Test pod curl images

- **CURL_IMG** (default: `curlimages/curl:latest`) — Used by `verify-metallb-advanced.sh` and the main verify script for in-cluster pods (LB traffic, hairpin, asymmetric, single-node path). This image supports HTTP/1.1 and HTTP/2 only.
- **HTTP/3 in-cluster** — For in-cluster HTTP/3 (e.g. `verify-colima-http3-direct.sh` step 1b), the pod needs a curl build with QUIC support. Use **HTTP3_CURL_IMAGE** (default: `rmarx/curl-http3:latest`). On aarch64/arm64, if that image fails to pull or run, try `HTTP3_CURL_IMAGE=alpine/curl-http3:latest`.

## Per-step skip

- `SKIP_BGP=1` — skip BGP check  
- `SKIP_ROUTE_FLAPS=1` — skip speaker restart / route flap  
- `SKIP_ARP_SIM=1` — skip ARP sim  
- `SKIP_ASYMMETRIC=1` — skip asymmetric routing  
- `SKIP_HAIRPIN=1` — skip hairpin test (pod → LB IP)  
- `SKIP_MULTI_SUBNET=1` — skip multi-subnet / multi-pool check  

Example:

```bash
SKIP_ROUTE_FLAPS=1 ./scripts/verify-metallb-advanced.sh
```

## Enabling BGP (when no BGPPeer exists)

The script reports "L2 mode only (no BGPPeer)" and prints steps to enable BGP.

**Easiest:** Run the FRR install script (builds a local Alpine+FRR image, no registry needed):
```bash
./scripts/install-metallb-frr-bgp.sh
```
This builds `frr-metallb:local` from `infra/k8s/metallb/frr/Dockerfile`, imports it into k3d, deploys FRR, creates BGPPeer, and applies BGPAdvertisement. Then re-run verification.

**Manual:**

1. **Deploy FRR**  
   - `kubectl apply -f infra/k8s/metallb/frr/`  
   - Or use `./scripts/install-metallb-frr-bgp.sh` which does the full flow.

2. **Apply BGPPeer** (if not using the script)  
   - Edit `infra/k8s/metallb/bgppeer.example.yaml`: set `peerAddress` to the FRR pod or Service IP.  
   - `kubectl apply -f infra/k8s/metallb/bgppeer.example.yaml`

3. **Apply BGPAdvertisement**  
   - `kubectl apply -f infra/k8s/metallb/bgpadvertisement.example.yaml`

4. **Verify**  
   - Re-run `./scripts/verify-metallb-and-traffic-policy.sh`. Expected: "BGP session(s) established (speaker logs show session up)".

## Enabling BGP (when no BGPPeer exists)

The script reports "L2 mode only (no BGPPeer)" and prints steps. To address that:

1. **Deploy a BGP router** that the MetalLB speaker can reach (e.g. FRR in a pod, or an external router on the same L3 as your nodes).
2. **Edit and apply BGPPeer**  
   - Copy or edit `infra/k8s/metallb/bgppeer.example.yaml`: set `peerAddress` to your BGP router IP, and `myASN` / `peerASN` to your AS numbers.  
   - `kubectl apply -f infra/k8s/metallb/bgppeer.example.yaml`  
   - If your MetalLB version only has `metallb.io/v1beta1` for BGPPeer, change the `apiVersion` in the file.
3. **Apply BGPAdvertisement**  
   - `kubectl apply -f infra/k8s/metallb/bgpadvertisement.example.yaml`  
   - This advertises the `record-platform-pool` range via BGP.
4. **Re-run verification**  
   - `./scripts/verify-metallb-and-traffic-policy.sh`  
   - With a working BGP router, the script will report "BGP session(s) established (speaker logs show session up)".

## Manual / deeper tests

- **BGP**: Configure a BGP router (e.g. FRR in the cluster or external) and BGPPeer + BGPAdvertisement; ensure the speaker can reach the router and peer. Re-run verification; the script will then report "BGP session(s) established" when speaker logs show session up.  
- **ARP poisoning**: From a host on the same L2 segment, send gratuitous ARP for the LB IP and verify service remains reachable or that MetalLB/ARP behavior is as expected.  
- **Asymmetric routing**: Use two different source IPs or paths to the LB IP and verify both directions work.  
- **Multi-subnet failover**: With multiple pools, drain or fail the node holding the current LB IP and confirm failover to another pool/node.

## Script location

- **Advanced script**: `scripts/verify-metallb-advanced.sh`  
- **Main verification**: `scripts/verify-metallb-and-traffic-policy.sh` (calls the advanced script by default unless `SKIP_METALLB_ADVANCED=1`).
