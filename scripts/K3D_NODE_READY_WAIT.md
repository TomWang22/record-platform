# Why "Waiting for nodes Ready" can take a long time

After k3d **node restart** (e.g. in `k3d-registry-push-and-patch.sh` so k3s picks up registry config), the script waits for **all nodes Ready** (default up to 240s, check every 5s). It’s normal for this to take **1–2+ minutes**; sometimes longer on a busy machine or first run.

## What you’ll see

- **Every 15s** the script prints the **current node status** (which node is Ready vs NotReady) so you can see progress and which node is slow.
- If the API is up but a node is still **NotReady**, the script suggests:  
  `kubectl describe nodes | grep -A2 Conditions`  
  to see the reported reason (e.g. `KubeletNotReady`, `ContainerRuntimeNotReady`).

## Why it can be slow

1. **k3s / kubelet startup** – After a full node restart, k3s and the kubelet need time to start and mark the node Ready.
2. **Containerd** – Container runtime must be up before the node is considered Ready.
3. **Resource pressure** – CPU/memory load on the host can slow startup.
4. **Docker/k3d** – Restarting the node container itself adds time before k3s inside it can respond.

## What you can do

- **Let it run** – Default 240s is usually enough; the script will proceed as soon as all nodes are Ready.
- **Increase wait** – If your environment often needs more time:
  ```bash
  export K3D_NODE_READY_WAIT=360   # 6 min
  ./scripts/k3d-registry-push-and-patch.sh
  ```
- **Longer initial settle** – If the API port often isn’t open by the first check:
  ```bash
  export K3D_NODE_READY_SETTLE=40  # 40s before first poll (default 25)
  ```
- **Investigate a stuck node** – Use the printed node name and:
  ```bash
  kubectl get nodes
  kubectl describe nodes | grep -A2 Conditions
  ```
  Common conditions: `KubeletNotReady` (kubelet still starting), `ContainerRuntimeNotReady`, `NetworkUnavailable` (CNI not ready).
- **Skip node restart** – If you don’t need to change registry config and want to avoid the wait:
  ```bash
  K3D_SKIP_NODE_RESTART=1 ./scripts/k3d-registry-push-and-patch.sh
  ```
  (Image pulls may still use HTTPS and fail until nodes are restarted or config is applied another way.)

## Diagnostic file

If nodes never become Ready within the wait, the script writes a diagnostic to  
`bench_logs/k3d-nodes-not-ready-<timestamp>.txt`  
with `kubectl get nodes`, `kubectl get nodes -o wide`, and docker/k3d status so you can inspect after the run.
