# MetalLB and API 503 — Report for Ops and AI Assistants

**Purpose:** Single reference for why MetalLB/pool apply often fails with `ServiceUnavailable (503)` or webhook "endpoints not found", what each script does, and how to fix or work around it. Use this when debugging preflight slowness, reissue step 2, or "apply metallb pool" failures. **See also:** `PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md` (why preflight used to work, Docker/Kind/observability checklist).

**Last updated:** 2026-02-07

---

## 1. What we’re doing (goal)

- **MetalLB:** L2 load balancer so Kubernetes `LoadBalancer` services get a stable external IP (no cloud LB). Pool range default: `192.168.106.240–192.168.106.250` (Colima VM subnet).
- **Caddy:** Edge TLS/HTTP/3 service. We switched it from `NodePort` to `LoadBalancer` so it gets an IP from MetalLB. We also set **sessionAffinity: ClientIP** (1h) so traffic is not plain round-robin (fewer reconnects/TLS handshakes).
- **Preflight** (e.g. `run-preflight-scale-and-all-suites.sh`) is supposed to: install MetalLB (step 3c1), apply Caddy deploy + service (step 3c2), then scale and run suites. In practice, step 3c1/3c2 often hit **503** and fail.

---

## 2. Why 503 happens (root cause)

- **kubectl apply** does a **GET** (to fetch current object), then **PATCH** (or CREATE). If the API server is overloaded, it returns **503 ServiceUnavailable** on the GET. Then `apply` fails even though the cluster is “up.”
- **When the API gets overloaded:**
  - **Reissue step 2** does many rapid `kubectl create/delete secret` calls in two namespaces. That burst often coincides with preflight and can trigger 503 or connection resets.
  - **Preflight** runs reissue, then Kafka SSL, then applies several kustomizations, then scale, then Caddy apply. By the time we try to apply MetalLB pool or Caddy service, the API may still be catching up.
  - **Single-node Colima/k3s:** One API server; no horizontal scaling. Under a burst of writes, it can return 503 or “connection refused” (ephemeral port in VM) for several seconds.

So the **underlying issue** is not MetalLB itself but **API server load during preflight**. MetalLB pool and Caddy service apply are just the visible failures because they run in that window.

**Webhook "endpoints not found":** If the first error is `InternalError: failed calling webhook ... endpoints "webhook-service" not found`, the MetalLB **controller** (which serves the validation webhook) was not ready yet. Wait for the controller pod and for `webhook-service` in `metallb-system` to have endpoints, then retry. The script `apply-metallb-pool-and-caddy-service.sh` now waits for the webhook before applying pool/L2.

---

## 3. Scripts involved (what does what)

| Script | What it does | When it fails |
|--------|----------------|----------------|
| **`scripts/install-metallb.sh`** | (0) Waits for API (up to 60s). (1) Applies MetalLB manifest (controller + speaker) from upstream URL. (2) Waits for controller/speaker pods. (3) Applies pool + L2 from `infra/k8s/metallb/`. | 503 on manifest apply; 503 or EOF on pool/L2 apply. |
| **`scripts/apply-metallb-pool-and-caddy-service.sh`** | (1) Wait for API. (2) Wait for MetalLB webhook (controller) so pool apply doesn't hit "endpoints webhook-service not found". (3) Retry apply for pool + L2. (4) Retry apply for Caddy service. Env: `MAX_WAIT`, `MAX_RETRIES`, `RETRY_SLEEP`. | 503 on apply; or InternalError if webhook not ready — script now waits for webhook then retries. |
| **`scripts/run-preflight-scale-and-all-suites.sh`** | Full pipeline: trim → preflight kubeconfig → ensure API → **reissue** (3a) → Kafka SSL → apply config/kafka/social/auction/analytics → **3c1 MetalLB** → **3c2 Caddy** → remove in-cluster K/Z/PG → scale → verify Caddy TLS → … | 503 at 3c1 or 3c2; reissue step 2 “apiserver not ready” or connection refused. |

**Key YAML:**

- **`infra/k8s/metallb/ipaddresspool.yaml`** — MetalLB address pool (single range).
- **`infra/k8s/metallb/l2advertisement.yaml`** — L2 advertisement for that pool.
- **`infra/k8s/caddy-h3-service.yaml`** — Caddy service: `type: LoadBalancer`, `sessionAffinity: ClientIP`, `sessionAffinityConfig.clientIP.timeoutSeconds: 3600`.

---

## 4. How to fix / work around

**Option A — Run apply when API is idle (recommended short-term)**  
After preflight has finished (or you’ve stopped it), run:

```bash
./scripts/apply-metallb-pool-and-caddy-service.sh
```

The script now waits for the API and retries apply (default 12×5s). If it still fails, ensure no other heavy `kubectl`/preflight is running and try again, or:

```bash
MAX_RETRIES=20 RETRY_SLEEP=8 ./scripts/apply-metallb-pool-and-caddy-service.sh
```

**Option B — Restart k3s then apply**  
If the API is stuck (e.g. still 503 after preflight stopped):

```bash
colima ssh -- sudo systemctl restart k3s
# wait ~60s
sleep 60
./scripts/apply-metallb-pool-and-caddy-service.sh
```

**Option B2 — Webhook never ready**  
If the script says "Webhook not ready" and then pool apply fails with InternalError (endpoints not found), the MetalLB controller may not be running. Check:

```bash
kubectl get pods -n metallb-system
kubectl get ep -n metallb-system webhook-service
```

If the controller pod is not Ready or is CrashLoopBackOff, check logs: `kubectl logs -n metallb-system deploy/controller`. If the namespace or MetalLB was never fully installed, run `./scripts/install-metallb.sh` first and wait until it reports "MetalLB components ready", then run `./scripts/apply-metallb-pool-and-caddy-service.sh` again.

**Option C — Preflight ordering / pacing (future)**  
To make preflight reliable with MetalLB without 503:

- **Pace step 2 (reissue):** Add short sleeps between secret create/delete or batch fewer secrets per run.
- **Run MetalLB before the big burst:** Install MetalLB and apply pool + L2 earlier (e.g. before reissue), when the API has had fewer writes.
- **Separate “apply Caddy service”:** Run Caddy service apply in a later step with its own retry loop (like `apply-metallb-pool-and-caddy-service.sh`), or run that script from preflight after a 30–60s settle delay.

These are design options for a follow-up change to preflight; not implemented yet.

---

## 5. How to verify things are correct

- **MetalLB controller/speaker:**  
  `kubectl get pods -n metallb-system`
- **Pool and L2:**  
  `kubectl get ipaddresspool -n metallb-system`  
  `kubectl get l2advertisement -n metallb-system`
- **Caddy service (LoadBalancer + IP):**  
  `kubectl -n ingress-nginx get svc caddy-h3`  
  You should see an **EXTERNAL-IP** from the pool (e.g. `192.168.106.240`) and the service type **LoadBalancer**.
- **Session affinity (no RR):**  
  `kubectl -n ingress-nginx get svc caddy-h3 -o yaml | grep -A5 sessionAffinity`

---

## 6. For another AI assistant (handoff)

- **Problem:** Preflight and “apply MetalLB pool + Caddy service” often fail with **503 ServiceUnavailable** because `kubectl apply`’s GET step hits an overloaded API server (reissue burst, single-node k3s).
- **What’s already done:**  
  - MetalLB install script waits and retries.  
  - `apply-metallb-pool-and-caddy-service.sh` waits for API and retries apply (configurable `MAX_WAIT`, `MAX_RETRIES`, `RETRY_SLEEP`).  
  - Caddy service YAML has LoadBalancer + sessionAffinity.  
  - This report documents cause, scripts, and fixes.
- **What’s left:**  
  - Make preflight less bursty or run MetalLB/Caddy apply later with a settle delay so 3c1/3c2 succeed consistently.  
  - Optionally add a “wait for API to settle” step after reissue before 3c1.

Use this doc plus `Runbook.md` (item 32, MetalLB / 503) and `scripts/apply-metallb-pool-and-caddy-service.sh` as the main references.
