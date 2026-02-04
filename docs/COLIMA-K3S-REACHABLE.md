# Colima + k3s: API Server Reachable at All Times

This doc summarises how to keep the Colima + k3s API server reachable from the host so `kubectl` and tests (baseline, enhanced, adversarial, rotation, standalone) don’t hang or timeout.

---

## 1. Recommended: No `--network-address`

**Use Colima + k3s without `--network-address`:**

```bash
colima start --with-kubernetes
# or with resources:
colima start --with-kubernetes --cpu 4 --memory 8
```

- Kubeconfig uses **`https://127.0.0.1:6443`** (Lima port forwarding).
- The API server is reachable as long as Colima is running.
- Avoids VM IP (e.g. `192.168.106.x`), col0 DHCP issues, and 502s on logs/port-forward.

**Expose services:** use `kubectl port-forward`, NodePort on forwarded ports, or ingress + port-forward — not the VM’s “reachable” IP.

---

## 2. If You Use `--network-address`: SSH Tunnel

When Colima is started with `--network-address` (or `network: address: true`), the API server is often advertised on the VM IP. The host may not reach it reliably → timeouts, `dial tcp 192.168.x.x:6443: i/o timeout`, etc.

**Workaround:** tunnel through Colima’s SSH and use `127.0.0.1:6443`:

```bash
# Terminal 1: keep this running (or run in background)
ssh -L 6443:127.0.0.1:6443 colima
```

Then ensure kubeconfig uses **`https://127.0.0.1:6443`** (see below). All `kubectl` traffic goes over the tunnel.

---

## 3. Ensure Kubeconfig Uses `127.0.0.1:6443`

For both “no `--network-address`” and “SSH tunnel” setups, the API server URL should be:

```text
https://127.0.0.1:6443
```

**Check current server:**

```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

**Fix if it points at VM IP (e.g. `192.168.106.2:6443`):**

```bash
kubectl config set-cluster colima --server="https://127.0.0.1:6443"
# use your actual cluster name if different, e.g. colima colima
```

---

## 4. Verify Cluster

**From host (preferred):**

```bash
kubectl get nodes
kubectl cluster-info
```

**From inside VM (when host → API is flaky):**

```bash
colima ssh -- kubectl get nodes
```

If `colima ssh -- kubectl` works but host `kubectl` doesn’t, the problem is host→VM access; use no `--network-address` or the SSH tunnel.

---

## 5. Single Colima + K8s Instance

Avoid multiple Colima Kubernetes instances all using host port `6443`. Use one Colima+K8s setup on `6443`, or accept that only one will work at a time.

---

## 6. References

| Topic | Link |
|-------|------|
| kubectl timeout with `--network-address` | [colima#812](https://github.com/abiosoft/colima/issues/812) |
| Cluster not accessible from host (VM IP) | [colima#1002](https://github.com/abiosoft/colima/issues/1002) |
| 502 on logs/port-forward with `--network-address` | [colima#1081](https://github.com/abiosoft/colima/issues/1081) |
| col0 DHCP / `--advertise-address` empty | [colima#939](https://github.com/abiosoft/colima/issues/939) |

---

**Bottom line:** Use **`colima start --with-kubernetes`** (no `--network-address`), keep kubeconfig on **`https://127.0.0.1:6443`**, and use port-forward/ingress for services. If you must use `--network-address`, run **`ssh -L 6443:127.0.0.1:6443 colima`** and point kubeconfig at **`127.0.0.1:6443`** for stable API access.
