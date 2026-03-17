# Platform Cluster and MetalLB — Single Doc for AI Handoff

**Purpose:** One document you can send to an AI or a teammate. Encodes infra decisions, non-negotiable order of operations, default path (k3d 2-node), MetalLB status, and concrete next steps. **Respect storage:** one doc, no duplication; references only.

---

## Decisions (fixed)

**Decision 2 — Infra validation is multi-node**

- **2 nodes minimum** for: cert reissue, MetalLB, full preflight.
- **3 nodes optional** for: headroom, future HA. Documented; no requirement to run 3 for normal validation.

**Decision 3 — Order of operations (non-negotiable)**

This order is fixed. **If anyone violates it, failures are expected and ignored.**

1. Bring up **2-node cluster**
2. **Verify API stability** (simple reads over time, e.g. `kubectl get ns default` several times)
3. **Apply API server tuning** (same script, multi-node context — for k3d this is baked into cluster create)
4. **Deploy platform workloads** (`kubectl apply -k infra/k8s/base ...`)
5. **Only then** install MetalLB
6. **Then** run full preflight / k6 / pgbench

**MetalLB status**

- MetalLB is **valid infra**, blocked only by single-node control plane limits. That’s a win, not a failure.
- ADR: L2 mode first; HAProxy + ingress unchanged; LoadBalancer only at the edge; clear rollback.
- On **2 nodes**: MetalLB will apply cleanly; the chunked installer becomes optional; most flakiness disappears.
- If it still fails on 2 nodes, **then** treat it as a MetalLB problem. Right now it is not.

**One sentence for sanity**

*The system didn’t get worse — it got honest. Multi-node is the correct fix, not more tuning.*

---

## Default path: k3d, same host, 2 nodes

**What you should actually do now:** k3d, 2 nodes (1 server + 1 agent), same host.

- Zero VM orchestration pain  
- Predictable networking  
- Easy to add/remove nodes  
- Fits project, demo, and CI-like runs  

**When to use Colima or multi-VM:** Only if you explicitly want VM realism or are testing host networking quirks. Not required to solve the current problem.

**Storage:** Ensure Docker has enough disk for 2 nodes (k3d uses Docker; clean with `k3d cluster delete record-platform` and `docker system prune` when done).

---

## Immediate next step (one-command path)

No more tuning beforehand. Use this sequence:

```bash
./scripts/k3d-create-2-node-cluster.sh
kubectl get nodes -w
```

When **both** nodes are Ready:

```bash
./scripts/install-metallb-chunked.sh
kubectl get svc -A | grep LoadBalancer
```

That’s it. For k3d, set `METALLB_POOL` to a range in the k3d Docker network (e.g. `172.18.0.240-172.18.0.250`); see `docker network inspect k3d-record-platform` for subnet.

**Full order (when doing full validation):** After MetalLB, deploy workloads (`kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s`), then run full preflight / k6 / pgbench.

**One command for the full flow (k3d + Docker + Postgres/Redis/Kafka up):**  
`./scripts/run-full-flow-k3d.sh`  
This: (1) builds and loads all :dev images into k3d, (2) restarts record-platform deployments, (3) waits for pods, (4) runs preflight (k6 + suites; set `RUN_FULL_LOAD=1` for pgbench too). Needs network for npm and Docker Hub during build.  
Optional: `SKIP_BUILD=1` to skip build (use existing images); `SKIP_PREFLIGHT=1` to stop after pods.  
**If builds time out (npm/Docker Hub):** run `./scripts/debug-build-network.sh`. If Docker Hub times out (image pull): run `./scripts/prepull-build-images.sh` when network is good, then `BUILD_NETWORK=host ./scripts/run-full-flow-k3d.sh`. See **docs/BUILD_NETWORK_FIX.md** for fixes once and for all.

**k3d images and registry:** Build uses host arch by default (linux/arm64 on M1/M2, linux/amd64 otherwise) so node pulls match. After build-and-load, run `./scripts/k3d-registry-push-and-patch.sh` to push :dev images to a local registry and patch deployments to pull from it (avoids k3d “image import” visibility issues). If pods show ImagePullBackOff (HTTPS) or “no match for platform”, rebuild for node arch (e.g. PLATFORM=linux/arm64 on M1/M2) then push again; or ensure registries.yaml is on both nodes and restart them if needed. See script output. The registry script now uses `kubectl set image` plus a JSON patch for `imagePullPolicy` only (it does not wipe env/volumeMounts). If api-gateway had crashed with "Certificates not found" at `/etc/certs`, re-apply base then run the registry script again.

**Preflight keeps 9/9 on k3d:** When you run preflight with k3d context, it (1) patches app deployments so `host.docker.internal` resolves in pods (on **macOS** we use Docker Desktop’s host gateway `k3d network gateway (e.g. 172.20.0.1)`; Redis/Postgres on the host reachable; hostAliases re-applied after 4a recovery pass since apply -k base overwrites them), and (2) runs the registry push-and-patch so all services use the local registry image. Base manifests use `imagePullPolicy: IfNotPresent` (not `Never`) so you never get ErrImageNeverPull; ensure :dev images exist (e.g. run full flow or build-and-load) before preflight so the registry has images to push.

**"Unable to connect to the server: EOF":** Another process may be bound to the k3d API ports (6443 and/or 55617). Run `lsof -i :6443 -i :55617`. If you see `ssh` or another process, it is intercepting traffic meant for k3d. Free the ports (close that SSH tunnel or stop the process) so k3d can be reached, then run `kubectl get nodes` again.

**HTTP/3 (QUIC):** QUIC uses **UDP**. k3d `--port` defaults to **TCP only**; without UDP 30443, HTTP/3 from the host fails (curl exit 7) on **both** LB IP and NodePort (single root cause). Caddy uses nodePort 30443 for both TCP and UDP. **Verify:** `./scripts/verify-k3d-30443-udp.sh` (checks serverlb has TCP+UDP 30443). **New clusters:** use `./scripts/k3d-create-2-node-cluster.sh` (publishes both `30443` and `30443/udp`). **Existing k3d:** recreate the cluster to get UDP 30443 (k3d does not support adding UDP to an existing port). **Root cause and rebuild checklist:** **docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md**. See **scripts/k3d-fix-30443-or-recover.sh** (RECREATE=1 to delete and recreate) and **docs/K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md** §2.4.

**k3d API server HA / “API server not ready”:** Tuning is **done once** at cluster create. **Create** with `./scripts/k3d-create-2-node-cluster.sh` (adds `--tls-san=127.0.0.1` and `--tls-san=localhost` so kubectl from host works with strict TLS; plus API/etcd tuning so the API is stable after restart). **Worst case:** preflight uses `K3D_AUTO_RESTART=1` when `REQUIRE_COLIMA=0`: if the API check fails, the script restarts the k3d cluster once, waits 60s, then retries. After that, “API server not ready” from TLS/SNI should not recur for clusters created with the script. **Existing clusters** that hit TCP OK but kubectl fails (x509/TLS): recreate with the script so the API server cert includes 127.0.0.1 and localhost. See **scripts/K3D_API_HA_AND_TLS.md**.

---

## What is done (chapters closed)

Do **not** reopen:

- “Try one more etcd tweak on single-node”
- “Maybe cert logic is wrong”
- “MetalLB YAML might be broken”
- “We should retry more aggressively”

You have: RCA, tuning scripts, guardrails, and a handoff doc that is usable by an AI. That work is complete.

---

## Order of operations (reference)

| Step | Action |
|------|--------|
| 1 | Bring up 2-node cluster (`./scripts/k3d-create-2-node-cluster.sh` or 2 VMs with k3s) |
| 2 | Verify API stability (e.g. 5× `kubectl get ns default` over 1–2 min) |
| 3 | Apply API server tuning (k3d: in create; VMs: `scripts/apply-k3s-etcd-tuning.sh` on server) |
| 4 | Deploy platform workloads |
| 5 | Install MetalLB |
| 6 | Run full preflight / k6 / pgbench |

---

## Script and doc reference

| What | Where |
|------|--------|
| Create 2-node k3d cluster (TLS SANs + API/etcd tuning baked in) | `scripts/k3d-create-2-node-cluster.sh` |
| k3d API HA / TLS (one-time tuning, restart behavior) | `scripts/K3D_API_HA_AND_TLS.md` |
| Full flow: build → restart → wait → preflight (k6) | `scripts/run-full-flow-k3d.sh` |
| Push :dev to local registry + patch deployments (after build) | `scripts/k3d-registry-push-and-patch.sh` |
| MetalLB chunked install | `scripts/install-metallb-chunked.sh` |
| MetalLB direct install | `scripts/install-metallb.sh` |
| API/etcd tuning (multi-node / Colima) | `scripts/apply-k3s-etcd-tuning.sh` |
| MetalLB pool/L2 YAML | `infra/k8s/metallb/` |
| Multi-node details (2→3, k3d vs VMs) | `docs/K3S_MULTI_NODE_AND_SCALING.md` |
| Root issues, hardening | `docs/COLIMA_K3S_ISSUES_AND_FIXES.md` |
| MetalLB traffic policy / L2 / scale | `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md` |
| ADR: multi-node required, MetalLB valid | `docs/adr/008-multi-node-required-metallb-valid.md` |
| Runtime & build dependencies | `docs/PLATFORM_DEPENDENCIES.md` |
| Caddy H3 (2 pods) + Envoy (1 pod) | See "Caddy and Envoy" below |
| Observability (Prom, Grafana, Jaeger, Otel, New Relic, Splunk, Linkerd, Istio) | See "Observability" below |
| Install Linkerd mesh | `scripts/install-linkerd.sh` |
| Install Istio mesh | `scripts/install-istio.sh` |
| New Relic + Splunk secrets (Otel) | `scripts/setup-observability-secrets.sh` (env: NEW_RELIC_LICENSE_KEY, SPLUNK_HEC_URL, SPLUNK_HEC_TOKEN) |
| **Run preflight on k3d** | `REQUIRE_COLIMA=0 ./scripts/run-preflight-scale-and-all-suites.sh` (strict TLS/mTLS and suites; certs, Docker Postgres/Redis/Kafka up). **Context:** Ensure k3d is current context (`kubectl config use-context k3d-record-platform`). If a previous run slimmed kubeconfig to colima-only, restore backup: `cp ~/.kube/config.bak.* ~/.kube/config`. The script does not switch to colima when `REQUIRE_COLIMA=0`. **Caddy strict TLS:** On k3d the script uses **in-cluster verify** (`verify-caddy-strict-tls-in-cluster.sh`) — no port-forward. For manual verify: `./scripts/verify-caddy-strict-tls-in-cluster.sh`. |
| Caddy strict TLS (in-cluster, no PF) | `scripts/verify-caddy-strict-tls-in-cluster.sh` |
| MetalLB + traffic policy check | `scripts/verify-metallb-and-traffic-policy.sh` |
| ADR: k3d default local cluster | `docs/adr/009-k3d-default-local-cluster.md` |
| **k3d preflight/suites wire investigation** | `docs/K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md` (root causes: host unreachable to Caddy, in-cluster verify exec on terminated pod, Secret type immutable; fixes applied) |
| **HTTP/3 + MetalLB root cause (RCA)** | `docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md` (why both LB IP and NodePort fail; k3d UDP 30443; Colima real L2; rebuild checklist) |
| **Verify k3d TCP+UDP 30443** | `scripts/verify-k3d-30443-udp.sh` (diagnose missing UDP 30443; exit 1 if UDP not published) |

**Caddy and Envoy:** For **2 Caddy H3 pods** in `ingress-nginx`: ensure configmap `caddy-h3` (from `docs/Caddyfile`) and secrets `record-local-tls`, `dev-root-ca` exist in `ingress-nginx`, then apply `infra/k8s/caddy-h3-deploy.yaml` and `infra/k8s/caddy-h3-service.yaml` (deploy has `replicas: 2`). For **1 Envoy pod** in `envoy-test`: ensure secret `dev-root-ca` exists in `envoy-test` (copy from `record-platform` if needed); base applies Envoy with `replicas: 1`. If Envoy stays ContainerCreating, `MountVolume.SetUp failed for volume "ca-cert" : secret "dev-root-ca" not found` → create the secret in `envoy-test`.

**Observability (full stack):** Base deploys **Prometheus**, **Grafana**, **Jaeger**, **Otel-collector** in `observability` namespace. Quick check: `kubectl get pods -n observability` and `kubectl get servicemonitor -n observability` (otel, jaeger, node-services, edge-exporters). **New Relic** and **Splunk:** Otel is wired via secrets `newrelic-secret` (key `license-key`) and `splunk-secret` (keys `hec-url`, `hec-token`). To set your keys in one shot: **`NEW_RELIC_LICENSE_KEY=... SPLUNK_HEC_URL=... SPLUNK_HEC_TOKEN=... ./scripts/setup-observability-secrets.sh`** (then Otel collector restarts). Or edit `infra/k8s/base/observability/newrelic-secret.yaml` and `splunk-secret.yaml` and re-apply. **ServiceMonitor/PodMonitor:** run **`./scripts/install-prometheus-operator-crds.sh`** once per cluster; base includes servicemonitors for otel, jaeger, node-services, edge-exporters. **Service meshes:** **Linkerd** — **`./scripts/install-linkerd.sh`** (requires linkerd CLI). **Istio** — **`./scripts/install-istio.sh`** (uses `istio-1.21.0/bin/istioctl`). After mesh install, enable injection on namespace and restart workloads. **Strict TLS/mTLS:** Unchanged.


---

## Summary for the AI

- **Infra validation** runs on **2 nodes minimum** (cert reissue, MetalLB, full preflight); 3 nodes optional.
- **Order is fixed:** 2-node cluster → verify API → tuning → deploy workloads → MetalLB → preflight/k6/pgbench. Violations = expected failures.
- **Default path:** k3d, same host, 2 nodes. Colima/VMs only for VM realism or host networking tests.
- **MetalLB:** Valid infra; blocked only by single-node. On 2 nodes it applies cleanly; if it fails there, then it’s a MetalLB issue.
- **Next step (k3d):** Start Docker, ensure ports 6443/55617 are free (Runbook #53), then run **`./scripts/setup-k3d-and-metallb.sh`** — applies base, pushes images to registry, patches deployments, installs MetalLB (pool from k3d network), waits for pods. Or manually: `./scripts/k3d-create-2-node-cluster.sh` → `kubectl get nodes -w` → when Ready → `./scripts/setup-k3d-and-metallb.sh` (or apply base + `./scripts/k3d-registry-push-and-patch.sh` + `METALLB_POOL=172.18.0.240-172.18.0.250 ./scripts/install-metallb-chunked.sh`).
- **Sanity:** Multi-node is the correct fix, not more tuning. This doc is the single handoff.

**Future work (not blocking):** Shedding (load-shed when overloaded), priority-based access (traffic classes / user tiers), and QoS (resource limits, PriorityClasses, L2/nodeSelector for MetalLB) — see `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md` for L2/priority; Runbook and ADRs for control-plane rate limits; extend as needed for app-tier shedding and QoS.
