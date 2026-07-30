# Colima + k3s + MetalLB L2 (Primary Setup)

**TL;DR:** Drop k3d. Use Colima + k3s directly with **bridged networking** (`--network-address`) and MetalLB L2. No nested Docker — QUIC, MetalLB L2, HA, and zero-downtime rotation all work on a sane network path.

---

## Why drop k3d

With **k3d** you had:

```
macOS → Colima VM → Docker → k3d loadbalancer container → kube-proxy → pod
```

That’s four networking layers before QUIC touches your pod. UDP and privileged ports (e.g. 443) suffer under that stack; Colima often doesn’t forward them to the host.

With **Colima + k3s** (no Docker in the path):

```
macOS → Colima VM (bridged IP) → k3s → MetalLB L2 → pod
```

MetalLB L2 behaves like real L2. No docker-proxy, no NodePort/hostPort hacks, no socat, no loopback alias. Real ARP, real failover.

---

## What you keep

- **QUIC / HTTP/3** on Caddy
- **MetalLB L2** with a real LAN pool
- **HA:** replica=2, anti-affinity, rolling updates, zero-downtime
- **Cert rotation** and control-plane semantics

Only the **transport** gets sane; app layer is unchanged.

**Externalized deps vs k8s services:** Redis, Kafka, Zookeeper, and the 8 Postgres instances run **outside** the cluster (Docker Compose on the host). All **app services** (api-gateway, auth-service, records-service, listings-service, analytics-service, python-ai-service, messaging-service, shopping-service, auction-monitor) run **in k8s** and connect to those deps via `host.docker.internal` (Postgres, Redis) and the **kafka-external** Service (Kafka SSL). Run `./scripts/ensure-dependencies-ready.sh` to start the external stack and optionally `./scripts/patch-kafka-external-host.sh` so kafka-external Endpoints point at the host. Pods need `host.docker.internal` to resolve: all app deployments include **hostAliases** (host.docker.internal → 192.168.5.2, default Lima gateway). If your Colima uses a different subnet, run `colima ssh -- getent hosts host.docker.internal` and override the alias in an overlay.

**Canonical layout:** **ingress-nginx** → 2 Caddy H3 pods; **envoy-test** → 1 Envoy pod; **record-platform** → all service pods + haproxy, nginx, nginx-exporter, haproxy-exporter; **external (Docker)** → Redis, Kafka, Zookeeper, 8 Postgres (that order). See **docs/PLATFORM_LAYOUT.md**. Verify with `./scripts/verify-platform-layout.sh`. Pods are in those namespaces, not `default`.

---

## Clean setup (do this exactly)

### 1. Delete k3d

```bash
k3d cluster delete record-platform
```

Remove Docker/k3d from the path.

### 2. Start Colima (bridged for MetalLB L2)

**For bridged mode (MetalLB L2), use the clean start.** The script pins k3s to **v1.29.6** (1.29 LTS). Do **not** use 1.32/1.33 on Colima+vz+bridged: k3s 1.33 has a regression (CRD registration → supervisor 127.0.0.1:51820 not yet bound → fatal). See **docs/COLIMA_K3S_CRASH_LOOP.md** §3.3.

```bash
./scripts/colima-start-k3s-bridged-clean.sh
```

Defaults: 12 CPU, 16 GiB RAM, 256 GiB disk, k3s v1.29.6+k3s1. Override: `CPU=8 MEMORY=12 DISK=100 ./scripts/colima-start-k3s-bridged-clean.sh`. Use Colima default k3s: `K8S_VERSION= ./scripts/colima-start-k3s-bridged-clean.sh` (not recommended for bridged). If download fails, use the full k3s tag, e.g. `K8S_VERSION=v1.29.0+k3s1`. The script verifies `kubectl get nodes` three times before finishing.

If you need **etcd/apiserver tuning** and have already confirmed a stable control plane with the clean script, you can use the tuned script with bridged: `COLIMA_NETWORK_ADDRESS=1 ./scripts/colima-start-k3s-bridged.sh`. Override resources: `CPU=8 MEMORY=8 DISK=100 ./scripts/colima-start-k3s-bridged.sh`.

To apply **conservative** etcd tuning after start (e.g. max-mutating 100): `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh`

**Check k3s + API + L2:** Run `./scripts/colima-check-k3s-and-l2.sh` to see whether Colima has k3s, the API is reachable, and what to run next (e.g. start with bridged script, fix kubeconfig, or run bring-up). If the API is flaky or MetalLB webhook never ready, **check k3s stability first**: `colima ssh -- sudo systemctl status k3s` — if you see "restart counter is at 295" (or any high number), k3s is crash-looping; see **docs/COLIMA_K3S_CRASH_LOOP.md** and run `./scripts/colima-diagnose-k3s-crash-loop.sh`. Fix k3s before installing MetalLB.

**If `kubectl` fails with "connection refused" or "no route to host":** The API port in kubeconfig can be stale after Colima restart. Run `./scripts/colima-fix-kubeconfig-localhost.sh` (it refreshes the port from Colima then fixes the host), then retry. Scripts do refresh + fix at start.

**If `kubectl` fails with "no route to host" only (VM IP in config):** Colima with `--network-address` writes the VM’s bridged IP in kubeconfig; the Mac may not route to it. Run:

```bash
./scripts/colima-fix-kubeconfig-localhost.sh
```

Then retry `kubectl get nodes`, and run the MetalLB and bring-up steps.

**If the script says "Cannot reach cluster API":** Scripts run the refresh and localhost fix at start. If it still fails, run `./scripts/colima-fix-kubeconfig-localhost.sh` and retry; or restart Colima and run the start script again.

**If you see "connection refused" to 127.0.0.1:PORT or "No resources found" in metallb-system:** Run `./scripts/colima-recover-and-bring-up.sh` once. It refreshes kubeconfig, verifies the API, installs MetalLB (including waiting for pods and webhook), and brings up the cluster. Or run `./scripts/colima-fix-kubeconfig-localhost.sh` then `METALLB_POOL=... ./scripts/colima-metallb-bring-up.sh`.

**If the webhook endpoint never appears or pool apply fails with "endpoints metallb-webhook-service not found":** The cause is the **MetalLB controller pod** not being Running (not timing or kubeconfig). Do not keep retrying bring-up. Run `./scripts/diagnose-metallb-controller.sh` or the three commands in **docs/METALLB_CONTROLLER_DEBUG.md** (pod status, describe events, controller logs). If the controller is CrashLoopBackOff, k3s 1.33 + MetalLB 0.14.5 may be incompatible; pin k3s with `K8S_VERSION=v1.29.0` when starting Colima (see that doc).

### 3. Verify k3s

```bash
kubectl get nodes
```

You should see a single control-plane node (or two if you added an agent).

### 4. Install MetalLB (L2)

Apply the native manifest, then configure pool + L2:

```bash
./scripts/install-metallb-colima.sh
```

Or manually:

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.5/config/manifests/metallb-native.yaml
# Wait for controller/speaker (and webhook) to be ready, then:
kubectl apply -f infra/k8s/metallb/ipaddresspool.yaml -f infra/k8s/metallb/l2advertisement.yaml
```

**Pool:** Set the pool to a range in **your LAN subnet** (same as Colima’s bridge). Find the VM’s IP with:

```bash
colima ssh -- ip addr
```

Use a small range (in VM L2: `192.168.5.240-192.168.5.250` for Colima eth0; do not use 192.168.1.x) that doesn’t overlap DHCP. Override when installing:

```bash
METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/install-metallb-colima.sh
```

**BGP + FRR (real networking):** With L2 in place, you can add BGP so the MetalLB speaker peers with an in-cluster FRR router:

```bash
./scripts/install-metallb-frr-bgp.sh
```

This builds the FRR image, deploys FRR in `metallb-system`, and applies **BGPPeer** + **BGPAdvertisement**. L2 (ARP) stays active; BGP is added. The speaker will establish BGP sessions to FRR; verify with `kubectl -n metallb-system logs -l component=speaker --tail=50 | grep -i bgp` or `./scripts/verify-metallb-and-traffic-policy.sh`. See **infra/k8s/metallb/README.md** and **docs/METALLB_ADVANCED.md**.

### 5. Bring up the platform and Caddy

**Optional (recommended for app pods):** Start Redis, Kafka (strict TLS), Zookeeper, and 8 Postgres on the host so k8s pods can reach them at `host.docker.internal`. This also ensures **Kafka SSL** (keystore/truststore in `certs/kafka-ssl`) and creates/updates **kafka-ssl-secret** in `record-platform` for strict TLS/mTLS and client mounts:

```bash
./scripts/ensure-dependencies-ready.sh
```

Then bring up the cluster:

```bash
./scripts/bring-up-colima-cluster.sh
```

Bring-up applies namespaces, TLS secrets, kustomize, and Caddy with a **LoadBalancer** service. MetalLB assigns an IP from the pool. No hostPort needed for host access — traffic goes Mac → LAN → MetalLB IP (ARP) → node → pod.

**One-shot (steps 4 + 5):** After Colima start (and API ready), you can run install MetalLB and bring-up in one command:

```bash
./scripts/colima-metallb-bring-up.sh
```

Optional pool: `METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/colima-metallb-bring-up.sh`. The script prints next steps (telemetry, Caddy LB IP).

**Post-bring-up — app pods:** Bring-up creates **kafka-ssl-secret** in `record-platform` from `certs/dev-root.pem` (dev CA) so pods that mount `kafka-ssl-certs` (analytics, auction-monitor, python-ai, shopping, social, etc.) can start. If **api-gateway**, **auth-service**, **listings-service**, or **records-service** are in **CrashLoopBackOff**, check logs: `kubectl -n record-platform logs deployment/<name> --previous`. Common causes: Postgres/Redis/Kafka not reachable (e.g. not started or wrong host in overlay), or missing env. Ensure DBs and dependencies match the dev overlay (e.g. `host.docker.internal` for Colima) and retry.

**Control-plane telemetry and drift:** To observe API/etcd pressure, run `./scripts/capture-control-plane-telemetry.sh --once` (single snapshot) or without `--once` for 3 snapshots 10s apart. See **docs/CONTROL_PLANE_TELEMETRY.md**. API pin: kubeconfig is fixed to 127.0.0.1 once; do not mutate mid-run. Serialized applies prevent control-plane drift (ADR-005, **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**).

### 6. Test from the Mac

Get the Caddy LoadBalancer IP:

```bash
kubectl -n ingress-nginx get svc caddy-h3
```

Then:

```bash
CADDY_IP=<assigned-external-ip>
curl -k -I --http2 -H 'Host: record.local' "https://${CADDY_IP}/_caddy/healthz"
curl -k -I --http3-only --resolve "record.local:443:${CADDY_IP}" "https://record.local/_caddy/healthz"
```

### 7. Run preflight and all suites (Colima primary)

With Colima + MetalLB L2 as the only cluster (no k3d), run preflight and suites on Colima:

```bash
REQUIRE_COLIMA=1 METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

This uses the Colima context, installs/verifies MetalLB (install-metallb-colima.sh), applies Caddy LoadBalancer (caddy-h3-service-loadbalancer.yaml), ensures :dev images are built (step 2e), and skips k3d-only steps (3c0, 3c0a, 3c0b). Optional: `RUN_SUITES=0` for preflight only; `RUN_FULL_LOAD=0` for suites without pgbench/k6.

---

## Why this is the right move

- **No docker-proxy** — QUIC and TCP go straight through k3s and MetalLB.
- **Real L2** — You can observe ARP, test failover (kill Caddy pod, watch traffic shift), simulate node failure, measure MTTR.
- **No host 443 on macOS** — No privileged port, VPN, or firewall quirks; you use the MetalLB IP on the LAN.

---

## Important: bridged networking on macOS

MetalLB L2 only works as intended if the Colima VM has a **bridged** (LAN) address. If Colima runs in NAT-only mode, ARP for the MetalLB pool won’t leave the VM and the host won’t reach the LB IP. That’s why **`--network-address`** is required for this setup.

---

## Troubleshooting: k3s checksum error

If you see:

```text
error validating SHA sum for 'k3s-arm64': exit status 1
shasum: standard input: no properly formatted SHA checksum lines found
```

Colima’s k3s download is failing checksum validation (known with some k3s release layouts). Try:

1. **Fresh Colima VM** so it re-downloads with a different cache path:
   ```bash
   colima delete
   ./scripts/colima-start-k3s-bridged.sh
   ```
2. **Upgrade Colima:** `brew upgrade colima` (newer versions may fix the validator).
3. **Skip version** so Colima picks its default (script now omits `--kubernetes-version` unless you set `K8S_VERSION`).

---

## References

- **Scripts:** `scripts/colima-start-k3s-bridged-clean.sh` (bridged, no k3s tuning; use first), `scripts/colima-start-k3s-bridged.sh` (optional tuned), `scripts/install-metallb-colima.sh`, `scripts/bring-up-colima-cluster.sh`, `scripts/apply-k3s-etcd-tuning.sh`
- **etcd / k3s tuning:** `docs/COLIMA_K3S_TUNING.md`, `docs/adr/006-colima-k3s-etcd-tuning.md`
- **MetalLB config:** `infra/k8s/metallb/` (ipaddresspool.yaml, l2advertisement.yaml)
- **Caddy:** LoadBalancer service `infra/k8s/caddy-h3-service-loadbalancer.yaml` (used by bring-up-colima-cluster.sh)
- **k3d vs 8443 (legacy):** `docs/HTTP3-K3D-DOCKER-PROXY.md`
