# MetalLB webhook never ready: debug the controller pod

**If the webhook endpoint never appears after 2 minutes, the cause is not timing, kubeconfig, or API drift.**

The MetalLB **controller pod** is not Running. The webhook is served by that pod; no controller → no webhook endpoint → pool/L2 apply fails with "endpoints metallb-webhook-service not found".

**Check k3s first.** If **k3s.service is crash-looping** inside the Colima VM (restart counter 200+), that is the root cause. The API keeps dying → controller never stabilizes → webhook never ready. See **docs/COLIMA_K3S_CRASH_LOOP.md** and run `./scripts/colima-diagnose-k3s-crash-loop.sh`. Fix k3s (etcd reset or `colima delete` + fresh start) before debugging MetalLB.

**Do not keep retrying bring-up.** If k3s is stable, inspect the controller (below).

---

## 1. Commands to run (in order)

### 1) Pod states

```bash
kubectl get pods -n metallb-system -o wide
```

Look for: **CrashLoopBackOff**, **ImagePullBackOff**, **Pending**, **ContainerCreating**, or no controller pod at all.

### 2) Describe the controller pod

```bash
kubectl describe pod -n metallb-system -l app=metallb,component=controller
```

Check the **Events** section: failed mount, webhook cert, API, permission denied, etc.

### 3) Controller logs

```bash
kubectl logs -n metallb-system deployment/controller
```

If empty (no pod yet), list pods and use the actual name:

```bash
kubectl logs -n metallb-system pod/<controller-pod-name>
```

Paste the output of these three (especially `get pods` and `describe` events) to see root cause.

---

## 2. Likely cause: k3s 1.33 + MetalLB 0.14.5

You may be on **k3s v1.33.x**. MetalLB v0.14.5 is typically validated against **Kubernetes 1.27–1.30**. K3s 1.33 is ahead of that; the controller can crash due to:

- Webhook TLS bootstrap failure  
- Admission registration / API changes  
- CRD or API version mismatch  

So the controller pod may be **CrashLoopBackOff** or never reach Running.

---

## 3. Options

### Option A — Pin k3s to a known-good version (recommended)

Start Colima with a stable k3s that MetalLB supports:

```bash
colima stop
colima delete
K8S_VERSION=v1.29.0+k3s1 ./scripts/colima-start-k3s-bridged-clean.sh
```

(Use full k3s tag, e.g. `v1.29.0+k3s1`; the clean script defaults to `v1.29.6+k3s1`.) Then run bring-up. MetalLB 0.14.5 is known to work with 1.29.

### Option B — Try MetalLB main (newer manifest)

If you must stay on k3s 1.33, try the latest MetalLB manifest (may be less stable):

```bash
METALLB_VERSION=main ./scripts/install-metallb-colima.sh
# or edit install-metallb-colima.sh to use:
# https://raw.githubusercontent.com/metallb/metallb/main/config/manifests/metallb-native.yaml
```

---

## 4. One-shot diagnostic script

From repo root:

```bash
./scripts/diagnose-metallb-controller.sh
```

This runs the three commands above and prints pod status, describe events, and controller logs so you can paste one block.

---

## 5. Summary

| Symptom | Cause | Action |
|--------|--------|--------|
| Webhook endpoint never appears | Controller pod not Running | Run the 3 commands; check pod status/events/logs |
| Pool apply fails: "endpoints webhook-service not found" | Same: no controller → no webhook | Same: debug controller; consider K8S_VERSION=v1.29.0 |
| Controller CrashLoopBackOff | Likely k3s 1.33 + MetalLB 0.14.5 mismatch | Option A (pin k3s 1.29) or Option B (MetalLB main) |

**References:** `scripts/install-metallb-colima.sh` (prints this debug block when webhook/pool fail), `scripts/diagnose-metallb-controller.sh`, `docs/COLIMA-K3S-METALLB-PRIMARY.md`.
