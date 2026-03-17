# k3s crash-loop in Colima VM (restart counter 200+)

**If k3s.service is crash-looping inside the Colima VM, that is the root cause of everything else.**

- kubectl sometimes works, sometimes "connection refused" → API keeps dying
- MetalLB webhook never comes up → controller never stabilizes
- Pool apply fails → admission requests hit an unstable API

**This is not a MetalLB, L2, or kubeconfig issue. It is k3s boot failure.**

---

## 1. Confirm k3s is crash-looping

Inside the VM:

```bash
colima ssh
sudo systemctl status k3s
```

Look for: **Active: activating (start-pre)** or **failed**, and **restart counter is at 295** (or any high number). That means systemd is repeatedly trying to start k3s and it keeps failing.

---

## 2. Get the real error (truth source)

Inside the VM:

```bash
colima ssh
sudo journalctl -u k3s -n 200 --no-pager
```

Paste that output to see why k3s is failing (etcd, disk, bind conflict, etc.).

---

## 3. Likely causes

- **Corrupted etcd data** after many restarts or mode changes
- **Disk pressure or inode exhaustion**
- **k3s flags / config mismatch** after experiments
- **API bind or network conflict** (e.g. switched between bridged and non-bridged, state persisted)
- **Network identity change** (vm-type=vz, bridged, etc.) with old etcd state
- **Stale internal API port** (see §3.1)
- **k3s 1.33 + Colima vz + bridged** supervisor race (see §3.3)

### 3.1 Stale internal API port (51820 vs 56907)

From journalctl you may see:

- API server **starts** and logs: `Serving securely on 127.0.0.1:56907`
- Then: `level=info msg="k3s is up and running"` and `Started k3s.service`
- Immediately after: `level=fatal msg="failed to start controllers: ... failed to create crd 'etcdsnapshotfiles.k3s.cattle.io' (or 'addons.k3s.cattle.io'): Post \"https://127.0.0.1:51820/apis/...\": dial tcp 127.0.0.1:51820: connect: connection refused"`

So the API server is listening on **56907** (or the advertised 56906), but an internal k3s component (CRD registration) is trying to reach the API at **127.0.0.1:51820**. Nothing listens on 51820 — that port is from an old run. After hundreds of restarts, some state under `/var/lib/rancher/k3s` still references 51820. The **nuclear option** (colima delete + fresh start) clears all of that; the surgical fix (rm server/db) may not remove the stale port reference if it lives in agent or other config. **If there is no 192.168.64.x in the logs**, see §3.3 instead (k3s 1.33 regression on Colima+vz+bridged).

### 3.3 k3s 1.33 supervisor port regression (Colima + vz + bridged)

On **macOS, Apple Silicon, Colima with VZ and bridged mode**, k3s **1.33** can crash during CRD registration with:

- `failed to create crd 'etcdsnapshotfiles.k3s.cattle.io': Post "https://127.0.0.1:51820/apis/...": dial tcp 127.0.0.1:51820: connect: connection refused`
- `Creating embedded CRD etcdsnapshotfiles.k3s.cattle...` then `failed to create new server context`

This is **not** dual network identity (no 192.168.64.x in the logs). k3s 1.33 changed internal supervisor / CRD boot ordering; the supervisor port is not yet listening when CRD registration runs. On Linux bare metal it works; under Colima + vz + bridged it races.

**Fix:** Pin to the **1.29 LTS** line. Do not use 1.32 or 1.33 for bridged mode.

```bash
colima stop
colima delete
./scripts/colima-start-k3s-bridged-clean.sh
```

The clean script **defaults** to `K8S_VERSION=v1.29.6+k3s1` (full k3s tag; Colima requires the `+k3s1` suffix or the download URL is wrong). If that version is unavailable, use `K8S_VERSION=v1.29.0+k3s1`. Then verify `kubectl get nodes` three times, then install MetalLB and bring up.

**If 1.29 still fails:** Try a different VM type: `VM_TYPE=qemu ./scripts/colima-start-k3s-bridged-clean.sh`. The script uses `--vm-type "$VM_TYPE"` (default `vz`). Some Apple Silicon + VZ combos trigger odd k3s behavior; QEMU can avoid it.

### 3.2 Dual network identity (bridged + NAT)

If you previously ran Colima in **NAT mode** (192.168.64.x) and now start with **bridged mode** (`--network-address` → 192.168.5.x), the VM can end up with two IP identities. In journalctl you may see:

- `Resetting endpoints for master service "kubernetes" to [192.168.5.1 192.168.64.7]`

That should never contain two networks. k3s starts, the API comes up, then internal supervisor logic tries to talk to itself via `127.0.0.1:51820`; the supervisor port is not bound correctly under dual-interface confusion, so CRD registration fails and k3s exits. **Custom k3s flags** (etcd tuning, apiserver args, `--tls-san`, `--node-ip`, `--advertise-address`) were often written for NAT mode and can make this worse in bridged mode.

**Fix:** Start Colima in **clean bridged mode only** — no extra k3s args. Use the dedicated script:

```bash
colima stop
colima delete
./scripts/colima-start-k3s-bridged-clean.sh
```

That script uses only `--kubernetes --vm-type=vz --cpu 12 --memory 16 --disk 256 --network-address` (overridable via env). No `--k3s-arg`. It then verifies `kubectl get nodes` three times in a row before declaring the control plane stable. Only after that should you install MetalLB and bring up the cluster.

---

## 4. Surgical fix (reset etcd only)

If you want to keep the VM and only reset k3s datastore:

Inside the VM:

```bash
colima ssh
sudo systemctl stop k3s
sudo rm -rf /var/lib/rancher/k3s/server/db
sudo systemctl start k3s
```

Then check:

```bash
sudo systemctl status k3s
```

If you see **Active: active (running)**, k3s is stable. Then on your Mac: `./scripts/colima-fix-kubeconfig-localhost.sh` and `kubectl get nodes`. Then install MetalLB and bring-up.

---

## 5. Nuclear option (recommended for local dev)

Wipe Colima and start clean. No ghost state.

On your Mac:

```bash
colima stop
colima delete
```

Then **for bridged/L2 (MetalLB)** use the **clean** script (pins k3s to 1.29 LTS; no etcd/apiserver tuning):

```bash
./scripts/colima-start-k3s-bridged-clean.sh
```

The script defaults to `K8S_VERSION=v1.29.6+k3s1` (do not use 1.32/1.33 on Colima+vz+bridged — see §3.3). It verifies `kubectl get nodes` three times before finishing. Only then:

1. Install MetalLB and bring up: `METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/colima-metallb-bring-up.sh`

If you need the **tuned** start (etcd/apiserver flags) and are **not** using bridged mode, use:

```bash
./scripts/colima-start-k3s-bridged.sh
```

(With `COLIMA_NETWORK_ADDRESS=0` the tuned script does not add `--network-address`.)

**Never install MetalLB on a cluster where k3s is restarting.**

---

## 6. Correct order of recovery

1. **Stabilize k3s** (journalctl → fix etcd or colima delete + start).
2. **Verify API**: `kubectl get nodes` works repeatedly.
3. **Then** install MetalLB.
4. **Then** apply pool/L2.
5. **Then** deploy Caddy / bring-up.

Control plane stability first. Everything else is downstream.

---

## 7. One-shot diagnostic (from Mac)

To print the k3s journal from the VM (run from repo root):

```bash
colima ssh -- sudo journalctl -u k3s -n 200 --no-pager
```

Paste the output to interpret the exact failure.

---

**See also:** `scripts/colima-diagnose-k3s-crash-loop.sh`, `docs/COLIMA-K3S-METALLB-PRIMARY.md`, `docs/METALLB_CONTROLLER_DEBUG.md`.
