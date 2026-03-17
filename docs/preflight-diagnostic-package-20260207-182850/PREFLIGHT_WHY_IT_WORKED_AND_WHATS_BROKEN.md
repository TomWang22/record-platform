# Preflight: Why It Used To Work and What’s Broken Now

**Purpose:** One place that compares the “good” preflight run (e.g. `preflight-full-20260206-215733.log`) with current failures, and lists what to check (Docker, Kind, MetalLB, observability). For you and for another AI assistant.

**Last updated:** 2026-02-07

---

## 1. Why it used to work (from preflight-full-20260206-215733.log)

- **Single cluster after cleanup:** Preflight saw “had 3 clusters” and slimmed kubeconfig to **one context (colima)**. So only Colima was used; no Kind in the active config.
- **Reissue step 2 used host kubectl:** There was **no** “Using colima ssh for step 2” — reissue ran from the host (tunnel 6443). Secret create/delete succeeded immediately with no retries.
- **No MetalLB in that run:** Preflight did **not** include steps 3c1 (MetalLB install) or 3c2 (Caddy apply). So no webhook/503 from MetalLB.
- **Docker/Kind/launch:** You mentioned that before removing Docker, Kind, and “default launch terminal” it was fine. So in the past:
  - **Docker** was running (Postgres, Kafka, Zookeeper for preflight 3b/3b2/3b3).
  - **Kind** may have been in kubeconfig or used elsewhere; preflight still succeeded because it switched to Colima and slimmed to one cluster.
  - **Default launch/terminal** might have avoided extra load or a different kubeconfig state.

So “it used to work” = **Colima-only after cleanup + host kubectl for reissue + no MetalLB steps + Docker (and possibly Kind) present**.

---

## 2. What’s broken / different now (summary)

| Issue | What happens | Where to look |
|-------|----------------|----------------|
| **Reissue step 2 slow / fails** | “connection refused” or “apiserver not ready” to in-VM API; many retries; sometimes fallback to host. | Runbook item 32; reissue uses colima ssh when `REISSUE_STEP2_VIA_SSH=1`; in-VM k3s port can be down or 503. |
| **MetalLB pool apply fails** | “endpoints webhook-service not found” (InternalError) or 503 (ServiceUnavailable). | MetalLB controller pod not ready → webhook has no endpoints. `METALLB_AND_API_503_REPORT.md`; `./scripts/apply-metallb-pool-and-caddy-service.sh` (and Option B2). |
| **API 503 under load** | Preflight or apply script gets 503 when doing many API writes (reissue burst, then MetalLB/Caddy apply). | Single-node k3s; burst of writes overloads API. `METALLB_AND_API_503_REPORT.md` §2 and §4. |
| **Docker not running** | If Postgres/Kafka/ZK are expected from Docker, steps 3b2/3b3 can fail or be skipped; suites may fail later. | `docker ps` (see checklist below). Preflight 3b2/3b3. |
| **Kind vs Colima** | Preflight is **Colima-only** (exits if context is Kind). If your default or another terminal used Kind, that can confuse which cluster is “current.” | `kubectl config current-context`; `kubectl config get-contexts`; Runbook “no Kind” guardrail. |
| **Observability pods** | Monitoring/observability stacks (Prometheus, Grafana, etc.) may not be running if base wasn’t applied or namespaces are missing. | `scripts/preflight-environment-check.sh`; `kubectl get pods -n monitoring`; `kubectl get pods -n observability`. |

---

## 3. Checklist: run before or after preflight

Use this (or run `./scripts/preflight-environment-check.sh`) to see current state.

### 3.1 Docker (Postgres, Kafka, Zookeeper)

Preflight 3b2/3b3 expect Docker Compose for Kafka and Postgres. If you “removed Docker” or don’t run it:

```bash
docker ps
# Expect (if using docker-compose): postgres, kafka, zookeeper, postgres-*, etc.
```

- If **nothing** relevant is running: start with `docker compose up -d …` as in preflight (see `run-preflight-scale-and-all-suites.sh` 3b2/3b3), or accept that DB/Kafka steps will warn/skip and suites may fail.

### 3.2 Kind vs Colima

Preflight **requires Colima** and exits if context is Kind:

```bash
kubectl config current-context   # should be colima
kubectl config get-contexts      # see all; preflight will slim to one
```

- If you had Kind as default before and removed it, ensure no stray `KUBECONFIG` or context points at Kind when running preflight.

### 3.3 MetalLB (webhook / pool / Caddy)

If `apply-metallb-pool-and-caddy-service.sh` fails with “endpoints webhook-service not found”:

```bash
kubectl get pods -n metallb-system
kubectl get svc,ep -n metallb-system
kubectl logs -n metallb-system deploy/controller --tail=50
```

- **Controller not Running:** Fix controller (logs, image pull, resources); then re-run apply script.
- **Controller Running but no endpoints:** Check service selector vs pod labels (see `METALLB_AND_API_503_REPORT.md` Option B2).

### 3.4 Observability pods

Base kustomization includes `monitoring` and `observability`. Check if stacks are there:

```bash
kubectl get pods -n monitoring
kubectl get pods -n observability
```

- **monitoring:** Often empty or optional (ServiceMonitors need Prometheus Operator).  
- **observability:** Expect (if applied) e.g. otel-collector, jaeger, prometheus, grafana. If namespace or pods are missing, base may not have been applied or resources failed to create.

### 3.5 One-command check script

```bash
./scripts/preflight-environment-check.sh
```

Prints: context, nodes, all namespaces, pods in all namespaces, Docker, MetalLB pods/ep, Caddy service, monitoring/observability. If API unreachable, tries Colima 6443 tunnel once. Short “what to fix” hint.

---

**Full diagnostic report (pipe to file for an AI):** `./scripts/generate-preflight-diagnostic-report.sh > preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt` — env check, all namespaces/pods, relevant file paths, how to run preflight and diagnose. With reset diagnostic: `RUN_DIAGNOSE=1 ./scripts/generate-preflight-diagnostic-report.sh > preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt`.

## 4. What to fix first (order)

1. **Docker:** If you need Postgres/Kafka for preflight/suites, run `docker compose up -d` for the services preflight expects (see 3b2/3b3 in the script).
2. **Context:** Run preflight with Colima context only; run `./scripts/preflight-environment-check.sh` to confirm.
3. **MetalLB:** If you want LoadBalancer Caddy, get the controller running and webhook endpoints present, then run `./scripts/apply-metallb-pool-and-caddy-service.sh`. If you prefer to skip MetalLB for now, revert Caddy to NodePort (see Runbook).
4. **Reissue flakiness:** Use `REISSUE_STEP2_VIA_SSH=0` to force host kubectl for step 2 when the tunnel is stable; or keep SSH and fix in-VM k3s (restart, resources). See Runbook item 32.
5. **Observability:** If you need Prometheus/Grafana/etc., ensure base is applied and namespaces exist; fix any failing deployments in `monitoring` / `observability`.

---

## 5. For another AI assistant

- **Good run reference:** `preflight-full-20260206-215733.log` — reissue step 2 via host kubectl, no MetalLB, kubeconfig slimmed to colima.
- **Current failures:** Reissue step 2 (in-VM API/connection refused), MetalLB pool apply (webhook endpoints not found, or 503), API 503 under load. User also removed Docker/Kind/default launch and wants to know if that explains the regression.
- **Key docs:** This file; `METALLB_AND_API_503_REPORT.md`; Runbook.md item 32; `scripts/preflight-environment-check.sh`; `scripts/generate-preflight-diagnostic-report.sh` (full report for piping to AI); `scripts/apply-metallb-pool-and-caddy-service.sh`.
- **Observability:** Stacks live in `infra/k8s/base/monitoring` (often empty) and `infra/k8s/base/observability` (otel, jaeger, prometheus, grafana). Check with `kubectl get pods -n monitoring` and `-n observability`.
