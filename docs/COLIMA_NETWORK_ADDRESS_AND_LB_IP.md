# Colima `--network-address` and Direct LB IP (No Socat)

**TL;DR:** With Colima running **without** `--network-address`, the VM has no reachable IP on the Mac’s network, so the MetalLB LB IP (e.g. 192.168.5.240) is only reachable via a loopback alias + socat. That path breaks HTTP/3 (QUIC reply-path). To get **direct** LB IP and HTTP/3 from the host, start Colima **with** `--network-address` (and optionally `--network-driver slirp`), put the MetalLB pool in the same subnet as the VM, and keep the API reachable via kubeconfig at `127.0.0.1:6443` (or an SSH tunnel).

---

## Current state (no `--network-address`)

- **`colima list`** shows **ADDRESS** empty or N/A — VM is on NAT, not bridged.
- **API:** Colima forwards 6443 to the host → `https://127.0.0.1:6443` works; `kubectl` is stable.
- **LB IP:** The Mac cannot route to the MetalLB pool (e.g. 192.168.5.240) because that IP lives inside the VM’s network. So `setup-lb-ip-host-access.sh` adds a **loopback alias** and **socat** (TCP/UDP 443 → NodePort). HTTP/2 via LB IP works; **HTTP/3 often returns 000** due to QUIC reply-path asymmetry (replies go to the Mac’s real IP, not the alias).

---

## Goal: direct LB IP and HTTP/3 from the host

- **Colima with `--network-address`** (and, if needed, `--network-driver slirp`) gives the VM a **reachable IP** on the same L2 as the host (or a slirp-exposed address).
- **MetalLB pool** is set to a range in that subnet (e.g. 192.168.5.240–192.168.5.250).
- The **Mac can curl the LB IP directly** — no alias, no socat. `setup-lb-ip-host-access.sh` will take the “direct” path when it sees Colima + direct curl 200.
- **HTTP/3** works because there is no reply-path mismatch: traffic is real L2/bridged.

**Caveat:** With `--network-address`, Colima may put the **API server** on the VM IP in kubeconfig. The host sometimes can’t reach that IP reliably → `kubectl` timeouts. So you must keep using **`https://127.0.0.1:6443`** for the API (see below).

---

## Steps to use `--network-address`

### 1. Stop and (optionally) delete the current Colima VM

```bash
colima stop
# Optional: colima delete -f   # only if you want a clean VM
```

### 2. Start Colima with `--network-address`

**Minimal (try first):**

```bash
colima start --with-kubernetes --network-address --cpu 12 --memory 16 --disk 256
```

**If `colima list` still shows ADDRESS empty** (known Colima issue), try with the slirp driver so the VM gets an exposed IP:

```bash
colima start --with-kubernetes --network-address --network-driver slirp --cpu 12 --memory 16 --disk 256
```

On Apple Silicon you may need:

```bash
colima start --with-kubernetes --vm-type vz --network-address --cpu 12 --memory 16 --disk 256
```

(Add `--network-driver slirp` if ADDRESS is still empty.)

### 3. Check that the VM has a reachable ADDRESS

```bash
colima list
```

Confirm **ADDRESS** is non-empty (e.g. 192.168.106.2 or 192.168.5.x). If it’s still empty, see [colima#449](https://github.com/abiosoft/colima/issues/449) and try `--network-driver slirp` or the workarounds in the Colima docs.

### 4. Fix kubeconfig to use 127.0.0.1:6443 (keep API stable)

With `--network-address`, kubeconfig may point at the VM IP; the host often can’t reach it. Point the cluster at localhost:

```bash
kubectl config set-cluster colima --server="https://127.0.0.1:6443"
# Use your actual context/cluster name if different, e.g. colima
```

If the API port is not 6443, get it from Colima and set it:

```bash
# Check which port Colima forwarded
colima status
# Then: kubectl config set-cluster colima --server="https://127.0.0.1:PORT"
```

**Alternative:** run an SSH tunnel and use 127.0.0.1:6443 in kubeconfig:

```bash
ssh -L 6443:127.0.0.1:6443 colima
```

See **docs/COLIMA-K3S-REACHABLE.md** for full API-reachability options.

### 5. Set the MetalLB pool to the VM’s subnet

After MetalLB is installed, set the pool to a range in the **same subnet** as the VM’s ADDRESS (e.g. 192.168.5.240–192.168.5.250). The Mac must be able to route to that subnet (same L2 or slirp-exposed range).

```bash
# Example: VM ADDRESS is 192.168.5.1 → use 192.168.5.240-192.168.5.250
METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/install-metallb-colima.sh
# Or apply pool YAML with that range
```

### 6. Run setup-lb-ip-host-access (it will use direct path)

```bash
# LB_IP will often be assigned by MetalLB; get it from the service or use the pool start
LB_IP=192.168.5.240 ./scripts/setup-lb-ip-host-access.sh
```

If the Mac can reach the LB IP directly (no alias), the script will print **“Direct LB IP … reachable (HTTP/2 + HTTP/3). No socat needed”** and exit without starting socat. Then run **`./scripts/verify-metallb-and-traffic-policy.sh`**; it expects host → LB IP on the same network.

### 7. Pods 0/1: host.docker.internal and Postgres on host

App pods need to reach Postgres, Redis, and Kafka on the Mac host. The app config uses **host.docker.internal**. On Colima, k3s pods do not get Docker's host.docker.internal; preflight step **3c0-colima** (or **`./scripts/colima-apply-host-aliases.sh`**) patches all app deployments with a **hostAlias** so host.docker.internal resolves to the host gateway (e.g. 192.168.64.2). You must also run Postgres/Redis on the host: `docker compose up -d` (ports 5433–5440, 6379). See Runbook item 75.

---

## Summary

| Setup | API (kubectl) | LB IP from host | HTTP/3 from host |
|-------|----------------|------------------|------------------|
| Colima **without** `--network-address` | ✅ 127.0.0.1:6443 | Via alias + socat | ⚠️ Often 000 (reply path) |
| Colima **with** `--network-address` (+ kubeconfig fix) | ✅ 127.0.0.1:6443 (or tunnel) | ✅ Direct | ✅ Direct |

**References:**

- **docs/COLIMA-K3S-REACHABLE.md** — API stability, no `--network-address` vs SSH tunnel.
- **docs/COLIMA-K3S-METALLB-PRIMARY.md** — Full Colima + MetalLB L2 flow (references bridged start scripts).
- **docs/METALLB_INGRESS_EGRESS_AND_REAL_L2.md** — L2 and HTTP/3 with Colima.
