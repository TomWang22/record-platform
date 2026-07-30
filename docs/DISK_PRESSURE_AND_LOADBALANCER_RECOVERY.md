# Disk pressure and LoadBalancer recovery (single-node Colima)

When the node reports **DiskPressure** and pods stay **Pending** with:

```text
0/1 nodes are available: 1 node(s) had untolerated taint(s)
```

Caddy (and record-platform / envoy-test) pods cannot schedule until either disk is fixed or workloads tolerate the taint.

## 1. LoadBalancer setup (Caddy H3)

- **Service:** `infra/k8s/caddy-h3-service-loadbalancer.yaml` — MetalLB `LoadBalancer` for TCP/UDP 443 (and gRPC 5000, admin 2019).
- **Apply:** After MetalLB pool is installed:
  ```bash
  kubectl apply -f infra/k8s/caddy-h3-service-loadbalancer.yaml
  ```
- **Deploy Caddy:** `infra/k8s/caddy-h3-deploy.yaml` (with tolerations and preferred anti-affinity for single-node). Apply separately:
  ```bash
  kubectl apply -f infra/k8s/caddy-h3-deploy.yaml
  ```
- See **infra/k8s/metallb/README.md** for MetalLB pool, L2, and `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh`.

## 2. Fix disk pressure (recommended first)

Free disk on the node so the **DiskPressure** condition clears and the taint is removed:

```bash
# On host: aggressive cleanup (Colima VM uses host disk)
./scripts/emergency-disk-cleanup.sh

# Optional: inside Colima VM
colima ssh -- df -h
colima ssh -- "sudo docker system prune -af || true"
```

After disk is freed, the node condition may take a few minutes to clear. Then redeploy so new pods schedule without needing tolerations.

## 3. Schedule despite disk pressure (tolerations)

If you must run before disk is fully fixed, the following already include **disk-pressure tolerations** so pods can schedule on the tainted node:

- **Caddy:** `infra/k8s/caddy-h3-deploy.yaml` — toleration `node.kubernetes.io/disk-pressure:NoSchedule`; **preferred** (not required) anti-affinity so both replicas can run on one node.
- **record-platform + envoy-test:** dev overlay patch `infra/k8s/overlays/dev/patches/disk-pressure-tolerations.yaml` — same toleration for api-gateway, auth-service, records-service, listings-service, analytics-service, python-ai-service, messaging-service, shopping-service, auction-monitor, haproxy, nginx, haproxy-exporter, nginx-exporter, envoy-test.

Apply the dev overlay (includes the patch):

```bash
kubectl apply -k infra/k8s/overlays/dev
```

Then apply Caddy and the LoadBalancer service:

```bash
kubectl apply -f infra/k8s/caddy-h3-deploy.yaml
kubectl apply -f infra/k8s/caddy-h3-service-loadbalancer.yaml
```

## 4. Get all pods to 1/1 Ready (strict TLS/mTLS)

1. Fix disk (section 2) and/or apply manifests with tolerations (section 3).
2. Restart deployments so new pods replace Pending/Completed/Error/Evicted ones:
   ```bash
   kubectl rollout restart deployment -n record-platform --all
   kubectl rollout restart deployment -n envoy-test --all
   kubectl rollout restart deployment -n ingress-nginx caddy-h3
   ```
3. Wait for Ready:
   ```bash
   kubectl get pods -n record-platform
   kubectl get pods -n envoy-test
   kubectl get pods -n ingress-nginx -l app=caddy-h3
   ```
4. Ensure TLS/mTLS secrets and config are in place (e.g. `record-local-tls`, `dev-root-ca`, `envoy-client-tls` in envoy-test). See Runbook and strict-TLS/mTLS docs.

## 5. Verify

- **Caddy / HTTP/3:** `curl -k --http3-only https://<LB_IP>/_caddy/healthz` (use EXTERNAL-IP from `kubectl -n ingress-nginx get svc caddy-h3`).
- **Pre-ramp health gate:** `python3 scripts/run_transport_validation.py --capture --v2 --require-transport-proof` (requires Caddy pods Running and LB reachable).
