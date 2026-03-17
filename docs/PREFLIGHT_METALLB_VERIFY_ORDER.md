# MetalLB verify: standalone vs preflight

## Issue

- **Standalone:** `./scripts/verify-metallb-and-traffic-policy.sh` passes (Caddy is already deployed and has LoadBalancer IP).
- **In preflight:** The same verify step (3c1b) could fail when run as part of `./scripts/run-preflight-scale-and-all-suites.sh` (no caddy-h3 service yet, or no LB IP).

## Cause

MetalLB verification (3c1b) requires:

1. Caddy **deployment** and **LoadBalancer service** to exist (so the script can curl `caddy-h3.ingress-nginx.svc` and the LB IP).
2. MetalLB to have assigned an EXTERNAL-IP to the Caddy service.

Previously, **3c2 (Caddy deploy + service)** ran *after* **3c1b (MetalLB verify)**. So during preflight, 3c1b ran before Caddy was applied, and verify saw no caddy-h3 or no LB IP.

## Fix

In `run-preflight-scale-and-all-suites.sh`, **3c2 (apply Caddy deploy + LoadBalancer service) now runs before 3c1b**:

1. 3c1 — MetalLB install  
2. 3c1a — FRR BGP (optional)  
3. **3c2 — Caddy deploy + service** (so caddy-h3 exists and gets LB IP from MetalLB)  
4. Wait for caddy-h3 rollout (up to `PREFLIGHT_CADDY_ROLLOUT_WAIT` s)  
5. 3c1b — MetalLB verification  

The duplicate 3c2 block that used to run before step 3d was removed; Caddy is applied only once, before verify.

## If you still see failures

- Ensure **external infra** is up before preflight: `./scripts/ensure-dependencies-ready.sh` (or `./scripts/bring-up-external-infra.sh` then `./scripts/ensure-external-databases-created.sh`). Then run preflight or `./scripts/ensure-ready-for-preflight.sh` if that script is present.
- On Colima, ensure the **host route** for the MetalLB pool is in place (see `scripts/RUN-PREFLIGHT.md` and the IPv4-only route one-liner) so step 5 (host reachability to LB IP) passes.
- Increase wait before verify if Caddy is slow: `PREFLIGHT_CADDY_ROLLOUT_WAIT=180 ./scripts/run-preflight-scale-and-all-suites.sh`.

---

## Three Caddy pods (2 Running + 1 Pending)

**Symptom:** `kubectl get pods -n ingress-nginx` shows 2 caddy-h3 pods Running and 1 Pending (e.g. `caddy-h3-857b9d84c4-sdbxp`).

**Cause:** The deployment used `maxSurge: 1`. A rolling update (e.g. image change from 3c0a or 4a recovery on k3d, or a second apply) created a 3rd pod. Caddy has **required** pod anti-affinity (one pod per node). On a 2-node cluster both nodes already have a caddy pod, so the 3rd pod cannot be scheduled → Pending.

**Fix:** The deployment was changed to **maxSurge: 0** so a rolling update never creates more than 2 pods (replaces one at a time). If you already have 3 pods:

- Run `./scripts/reset-caddy-h3-to-default-image.sh` to reset image and scale down stale ReplicaSets, or
- Manually scale the Pending pod’s ReplicaSet to 0:  
  `kubectl get rs -n ingress-nginx -l app=caddy-h3` then  
  `kubectl scale rs <new-rs-name> -n ingress-nginx --replicas=0`

---

## Services 0/1 Ready (analytics, auction-monitor, listings, records, shopping)

**Symptom:** Pods are `Running` but `READY` is 0/1 (readiness probe failing).

**Cause:** These services depend on external infra: Postgres (per-service DB), Redis (6379), and Kafka (e.g. 29093 with TLS). Readiness uses gRPC health or HTTP; if DB/Kafka/Redis are unreachable or TLS misconfigured, the probe fails.

**Fix:**

1. Bring up external infra first:  
   `./scripts/ensure-dependencies-ready.sh` (or `./scripts/bring-up-external-infra.sh` then `./scripts/ensure-external-databases-created.sh`). Then run preflight (or `ensure-ready-for-preflight.sh` if present).
2. Ensure Kafka TLS secret exists: `kubectl get secret kafka-ssl-secret -n record-platform`
3. For Colima, ensure `kafka-external` Endpoints point to host (e.g. step 3e `patch-kafka-external-host.sh`)
4. Check one pod:  
   `kubectl logs -n record-platform deploy/shopping-service --tail=50`  
   and  
   `kubectl describe pod -n record-platform -l app=shopping-service`  
   for connection/readiness errors.

---

## Running MetalLB verify in the background

After tuning and seeding are in place, you can run MetalLB verification as a background process and inspect results later:

```bash
mkdir -p bench_logs
./scripts/verify-metallb-and-traffic-policy.sh > bench_logs/metallb-verify-$(date +%Y%m%d-%H%M%S).log 2>&1 &
echo "MetalLB verify PID=$! Log=bench_logs/metallb-verify-*.log"
```

Ensure Caddy is deployed and cluster is up before running (or run after preflight step 3c2). If verify fails in preflight, the fix is to run 3c2 before 3c1b (see above).
