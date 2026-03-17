# QUIC verification checklist (real L2 vs forwarder)

Use this to confirm **where** QUIC works and **why** it fails when testing through a host forwarder.

## HTTP/3 once and for all (canonical setup)

**Recommended:** Colima with bridged networking so the Mac can reach the MetalLB LB IP directly. No socat, no NodePort forward, no UDP hacks.

1. **Start Colima (bridged, 12 CPU / 16 GiB RAM / 256 GiB disk):**
   ```bash
   colima delete -f   # if you had a cluster before
   ./scripts/colima-start-k3s-bridged-clean.sh
   ```
   Equivalent to: `colima start --kubernetes --network-address --cpu 12 --memory 16 --disk 256`

2. **Install MetalLB** and set pool on VM L2 (Colima: `METALLB_POOL=192.168.5.240-192.168.5.250`), bring up Caddy LoadBalancer.

3. **From Mac (external to k8s):**
   ```bash
   curl --http3-only https://<LB_IP>/_caddy/healthz
   ```
   Example: `curl --http3-only https://192.168.5.240/_caddy/healthz`. Use `-k` if the dev CA is not in your trust store.

**Inside k8s:** Pods can reach the same LB IP (or NodePort) from within the cluster; with bridged, the LB IP is on the VM’s L2 interface so both host and pods use the same path to Caddy.

## The real problem

Chain today (when Mac is not on VM L2):

```
Mac (127.0.0.1:8443)
   ↓ socat (TCP + UDP forward)
VM 192.168.64.7:NodePort (kube-proxy)
   ↓
Pod (Caddy)
```

- **HTTP/2 works** — TCP survives the chain.
- **HTTP/3 (QUIC) fails** (e.g. `curl 000`) — UDP does not survive Mac → VM → NodePort.

QUIC is sensitive to:

- NAT rewriting  
- UDP fragmentation  
- Source port changes  
- Stateless firewall drops  
- GSO (disable with `NGTCP2_ENABLE_GSO=0` on macOS)  
- Reverse path filtering  

Three translation layers (macOS userspace socat, VM NAT, kube-proxy iptables) make QUIC fragile. **You are not crazy** — this is a network topology mismatch, not a broken cluster.

## Quick diagnostic (inside VM / node)

Proves Caddy and MetalLB are fine; only the forwarder is the problem.

1. **From the node (VM)** — HTTP/2 to NodePort and to LB IP (in-cluster curl image usually has no HTTP/3; HTTP/2 is enough to confirm path):

   ```bash
   ./scripts/verify-quic-diagnostic-in-vm.sh
   ```

   Or manually (replace `<NODEPORT>` e.g. 32449 and `<LB_IP>` e.g. 192.168.5.240):

   ```bash
   # NodePort (kube-proxy → Caddy)
   kubectl -n ingress-nginx run h2-np --rm -i --restart=Never --image=curlimages/curl:latest \
     --overrides='{"spec":{"hostNetwork":true}}' -- \
     curl -k -sS -o /dev/null -w '%{http_code}' --http2 -H 'Host: record.local' 'https://127.0.0.1:<NODEPORT>/_caddy/healthz'

   # LB IP (MetalLB L2 → Caddy)
   kubectl -n ingress-nginx run h2-lb --rm -i --restart=Never --image=curlimages/curl:latest \
     --overrides='{"spec":{"hostNetwork":true}}' -- \
     curl -k -sS -o /dev/null -w '%{http_code}' --http2 --resolve record.local:443:<LB_IP> https://record.local/_caddy/healthz
   ```

   **200** = Caddy and MetalLB path OK on the node.

2. **From inside VM with HTTP/3 curl** (if you have it, e.g. after `apt install curl` with QUIC or a custom build):

   ```bash
   colima ssh
   # On VM:
   curl -k --http3-only --resolve record.local:443:127.0.0.1 https://record.local/_caddy/healthz   # NodePort via localhost if Caddy is bound there
   curl -k --http3-only --resolve record.local:443:<LB_IP> https://record.local/_caddy/healthz   # MetalLB L2
   ```

   If both return 200 but **host** still fails → the only problem is the Mac→VM forwarder layer.

## Clean solution: bridged networking (real L2)

With bridged mode, the MetalLB LB IP is on your LAN. Your Mac talks to it directly. No socat, no NodePort, no UDP rewriting.

### 1. Full teardown + bridged start

**Full default (12 CPU, 16 GiB RAM, 256 GiB disk — same as metrics and full stack):**
```bash
colima stop
colima delete -f
./scripts/colima-start-k3s-bridged-clean.sh
```

**Minimal VM** (smaller resources):
```bash
colima delete -f
COLIMABRIDGED_MINIMAL=1 ./scripts/colima-start-k3s-bridged-clean.sh
```

Equivalent full command (no script):
```bash
colima start --kubernetes --network-address --cpu 12 --memory 16 --disk 256 --vm-type vz --kubernetes-version v1.29.6+k3s1
```

Then merge kubeconfig and wait for API (see script).

### 2. MetalLB + Caddy

- Install MetalLB and apply pool (e.g. 192.168.5.240–192.168.5.250) and L2Advertisement.
- Deploy Caddy with LoadBalancer service so it gets the LB IP on the VM’s bridged interface.

### 3. QUIC from host (no socat)

From your Mac (Homebrew curl with HTTP/3):

```bash
curl --http3-only https://<LB_IP>/_caddy/healthz
# e.g. curl --http3-only https://192.168.5.240/_caddy/healthz
# Use -k if the dev CA is not in your trust store.
```

**200** = QUIC works over real L2.

## When verify fails (127.0.0.1:8443 / no-sudo forward path)

If you are still using the no-sudo forwarder (127.0.0.1:8443) and HTTP/3 verify fails, the script prints this; you can also run manually:

1. **Check UDP 8443:**
   ```bash
   lsof -i UDP:8443
   ```
   - **Nothing listening** → socat died. Restart: `./scripts/setup-lb-ip-host-access-no-sudo.sh`
   - **Something listening but HTTP/3 still fails** → UDP socket is stale; restart the forwarder.

2. **Manual HTTP/3 test** (Homebrew curl with `--http3-only`):
   ```bash
   NGTCP2_ENABLE_GSO=0 /opt/homebrew/opt/curl/bin/curl --http3-only -k -v \
     --resolve record.local:8443:127.0.0.1 https://record.local:8443/_caddy/healthz
   ```

**Long-term:** Prefer bridged so the Mac hits the LB IP directly and this forwarder path is unnecessary. See "HTTP/3 once and for all" above.

## Why bridged failed before

Earlier issues were:

- **k3s 1.33 regression** (CRD/supervisor port race).
- **Dual identity / control-plane instability.**

On **k3s 1.29** (e.g. v1.29.6+k3s1) with **vz** and **--network-address**, bridged mode is expected to work. Use `colima-start-k3s-bridged-clean.sh` which pins 1.29 and documents the QUIC path.

## Summary

| Path                         | HTTP/2 | HTTP/3 (QUIC) |
|-----------------------------|--------|----------------|
| Host → socat → NodePort     | ✅     | ❌ fragile     |
| Host → LB IP (bridged L2)   | ✅     | ✅             |
| Node → NodePort / LB IP     | ✅     | ✅ (if curl has HTTP/3) |

**Recommendation:** Use bridged mode for HA, MetalLB L2, and HTTP/3. Do not test QUIC through a NodePort/socat simulation; use real L2 so QUIC behaves.
