# k3s crash loop: CRD registration to 127.0.0.1:51820 refused

**Symptom:** Cross-layer diagnostic shows k3s in a **restart loop** (ActiveState=activating, SubState=auto-restart). Recent log:

```
level=fatal msg="failed to start controllers: failed to create new server context: failed to register CRDs: failed to create crd 'addons.k3s.cattle.io': Post \"https://127.0.0.1:51820/apis/apiextensions.k8s.io/v1/customresourcedefinitions?timeout=15m0s\": dial tcp 127.0.0.1:51820: connect: connection refused"
```

You may still see **Host kubectl: API reachable** at the start of the diagnostic because the API can respond briefly between restarts; later sections then fail with "connection to server 127.0.0.1:XXXXX refused" as k3s crashes again.

---

## What’s going on

- k3s has an **internal** API listener (e.g. on 127.0.0.1:51820) used during bootstrap.
- During startup, one part of k3s tries to register CRDs (e.g. `addons.k3s.cattle.io`) by calling that internal API.
- If that listener isn’t ready yet (startup race) or the process is in a bad state, the connection to 127.0.0.1:51820 is **refused** → k3s exits → systemd restarts it → loop.
- So the **control plane is unstable**: sometimes the public API (6443) works for a few seconds, then the process crashes again.

### Related symptoms (same root cause)

- **ServiceUnavailable** on `kubectl get nodes` or other API calls — API is overloaded or not ready.
- **Error updating APIService "v1beta1.metrics.k8s.io" ... 503** — API returned 503 when registering metrics APIService; control plane not ready.
- **Error removing old endpoints from kubernetes service: no API server IP addresses were listed in storage** — Bootstrap ordering: API server endpoint not in etcd yet; k3s still starting.

All of these point to the same root: **control plane not fully ready or under load**. Fix: full Colima restart, **longer wait** (e.g. `RECOVERY_WAIT=120` or `180`), then re-forward 6443 and retry kubectl.

---

## What to do (in order)

### 1. Full Colima restart (recommended)

Clears in-memory state and any stuck port bindings; etcd data on disk is preserved.

```bash
colima stop
colima start --with-kubernetes
# Wait for VM and k3s to come up (60–90s)
sleep 90
./scripts/colima-forward-6443.sh
kubectl get nodes
```

If you use a custom profile (CPU/RAM), add those flags to `colima start`. **12 CPU is the typical max** for Colima on Mac; you can pin it so the restart doesn’t drop to default:

```bash
colima stop
colima start --with-kubernetes --cpu 12 --memory 12
# or more RAM if you have it (e.g. 16):
colima start --with-kubernetes --cpu 12 --memory 16
sleep 90
./scripts/colima-forward-6443.sh
```

Or use the recovery script with env: `COLIMA_CPU=12 COLIMA_MEMORY=12 ./scripts/colima-k3s-recover-from-crash-loop.sh`

### 2. Re-run diagnostic

```bash
./scripts/colima-k3s-cross-layer-diagnostic.sh
```

Check section 2 (k3s process): ActiveState should be **active**, SubState **running** (not activating/auto-restart). If it’s still crash-looping, try step 3.

### 3. Optional: check port 51820 in the VM

If restart didn’t fix it, see whether anything is listening on 51820 when k3s is supposed to be up:

```bash
colima ssh -- ss -tlnp | grep 51820
```

If nothing is listening and k3s keeps crashing, try a **new Colima profile** (see below).

**If 51820 keeps coming back after full restart:** The API can work briefly between restarts, so "recovery succeeded" might mean we caught a short window. Re-run the cross-layer diagnostic; if section 2 shows **ActiveState=activating, SubState=auto-restart** and the 51820 fatal again, try a **new Colima profile** (fresh VM / fresh etcd):

```bash
colima stop
colima delete   # WARNING: removes the VM and its data (k8s state; not host files)
colima start --with-kubernetes --cpu 12 --memory 16
# Then re-apply workloads and ./scripts/colima-forward-6443.sh
```

### 4. After k3s is stable

- Re-apply tuning: `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh` (or run `./scripts/stabilize-then-metallb.sh` which applies tuning in-VM).
- MetalLB: install only when the API is stable: `./scripts/stabilize-then-metallb.sh --metallb` or `./scripts/install-metallb.sh`.

---

## Resource dissection (CPU/RAM, max 12)

The 51820 crash-loop is usually **not** CPU starvation — it’s the internal API (port 51820) not being ready when CRD registration runs. So:

- **If you’re already at 12 CPU:** Full Colima restart is the right fix; adding more CPU isn’t possible (12 is the typical max) and won’t fix a startup-order race.
- **RAM:** If the VM has less than ~12GiB, giving more RAM (e.g. 12 or 16GiB) can help etcd and the API under load. It won’t fix 51820 by itself but can reduce pressure after recovery.

**See what you have and what’s in use:**

```bash
./scripts/colima-k3s-resource-dissection.sh
```

That script prints: Colima profile (CPU, mem, disk), in-VM view (nproc, free), node capacity/allocatable, k3s process RSS/CPU, and a short recommendation (max 12 CPU, restart first, then consider RAM).

---

## Other notes from your diagnostic

| Observation | Note |
|-------------|------|
| **/dev/vdc 100%** (54M /mnt/lima-cidata) | Cloud-init/cidata volume; often full by design. Not the cause of the 51820 crash. |
| **metallb-system namespace, no pods** | Namespace was created but MetalLB controller/speaker never deployed (e.g. API dropped during apply). Re-install MetalLB after k3s is stable. |
| **Host kubectl works then later sections fail** | Explains the race: API was up when section 1 ran, then k3s crashed before sections 4–7. |

---

## References

- **docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md** — All layers to check.
- **docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md** — General “why is it unhappy” flow.
- **scripts/colima-k3s-cross-layer-diagnostic.sh** — Detects this crash-loop and prints the fix line.
- **scripts/colima-k3s-resource-dissection.sh** — Dissect CPU/RAM profile and usage (max 12 CPU).
- **scripts/colima-k3s-recover-from-crash-loop.sh** — Full stop/start; set COLIMA_CPU=12 COLIMA_MEMORY=12 to pin resources.
