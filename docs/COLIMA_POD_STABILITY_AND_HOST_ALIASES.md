# Colima pod stability and host.docker.internal

## Why pods stay Init or 0/1 Ready

Pods in `record-platform` need to reach **Postgres** and **Redis** on the host (Docker Compose). They use the hostname **host.docker.internal**. On Colima/k3s, that name is **not** in DNS, so each deployment has **hostAliases** that map it to an IP (the host gateway from the VM’s point of view).

- If that IP is **wrong**, pods cannot reach Postgres/Redis. You then see:
  - **analytics-service** stuck in **Init:0/1** (init container `wait-db` does `nc -zv host.docker.internal 5433` and never succeeds).
  - **auction-monitor**, **social-service**, and others **0/1 Running** (readiness fails because DB/Redis is unreachable).
- Base YAML uses a **hardcoded** IP **192.168.5.2** (typical Lima/Colima default). Your Colima VM may use a **different** gateway (e.g. with `--network-address`, or a different subnet). Then the base alias is wrong and you get the instability above.

## Fix: apply the correct host alias

From repo root:

```bash
./scripts/colima-apply-host-aliases.sh
```

That script discovers the host gateway (node InternalIP, or `host.lima.internal`, or default 192.168.5.2) and **merge-patches** all app deployments so `host.docker.internal` points to that IP. After it runs, wait for rollouts; analytics init and other readiness probes should pass.

Override the IP if you know it:

```bash
HOST_GATEWAY_IP=192.168.106.2 ./scripts/colima-apply-host-aliases.sh
```

## Undo and when to re-apply

If you ran **colima-undo-host-aliases.sh**, deployments are restored from the repo and **hostAliases** go back to **192.168.5.2**. If that is not the correct gateway for your Colima setup, pods will again stay Init or 0/1 Ready. In that case, run **colima-apply-host-aliases.sh** again so the correct IP is patched.

## Services that depend on host.docker.internal

- **Init container** (must reach DB before main container starts): analytics-service (5433), listings-service (5435), python-ai-service (5440).
- **Readiness** (DB/Redis in app): auth-service, records-service, social-service, shopping-service, auction-monitor, etc.

All of these use the same **hostAliases** in the pod spec. One wrong IP affects all of them.

## Quick check

From the host, see what IP Colima uses for the host gateway:

```bash
colima ssh -- getent hosts host.lima.internal
# or
kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}'
```

If that IP is not 192.168.5.2, use **colima-apply-host-aliases.sh** (or set **HOST_GATEWAY_IP**) so pods resolve **host.docker.internal** correctly.

## k3d (REQUIRE_COLIMA=0)

On **k3d**, pods also need **host.docker.internal** to reach Postgres/Redis on the host. The base YAML uses 192.168.5.2 (Colima); on k3d the correct IP is usually the **k3d network gateway** (e.g. 172.20.0.1) or the host as seen from the cluster.

**Fix:** From repo root:

```bash
./scripts/apply-k3d-host-aliases.sh
```

Preflight (when context is k3d) runs this automatically in step 3c0 and again after step 3c. If you see **502 on Test 12f** or **logged:false on 13k/13k2** after preflight, run **apply-k3d-host-aliases.sh** manually (e.g. step 3c may have run before 3c0 in some flows, or the discovered gateway may be wrong). Override the IP if needed:

```bash
HOST_GATEWAY_IP=172.20.0.1 ./scripts/apply-k3d-host-aliases.sh
```

See **diagnose-502-and-analytics.sh** for full connectivity checks.
