# HTTP/3 (QUIC) and Colima UDP Fixes

Reference for the five failure areas when **HTTP/2 works but HTTP/3 from host fails** and packet capture shows **UDP 443: 0**. Platform (gRPC, DB, TLS) is healthy; the issues are UDP exposure, capture filter, k6 resources, and rotation timing.

---

## 1. HTTP/3 from host → MetalLB (UDP 443 not exposed)

**Symptom:** `curl: (7) QUIC: connection to 127.0.0.1 port 30443 refused`, HTTP Code 000. TCP 443 has traffic; UDP 443: 0.

**Cause:** Colima/k3s forwards TCP reliably; UDP 443 often does not reach the pod unless the **Service** explicitly exposes it.

**Fix:**

- Use the **LoadBalancer** service that exposes **both** TCP and UDP 443:
  - **Service:** `infra/k8s/caddy-h3-service-loadbalancer.yaml` — `ports` must include:
    - `name: https`, `port: 443`, `protocol: TCP`
    - `name: https-udp`, `port: 443`, `protocol: UDP`
  - **Deploy (Colima, no hostPort):** `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` so two Caddy replicas can run on one node.

- Apply with MetalLB enabled:
  - `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh`
  - Or preflight with `METALLB_ENABLED=1` (uses the LoadBalancer service when Colima context is detected).

- Confirm:
  - `kubectl get svc -n ingress-nginx caddy-h3 -o yaml` must show both `protocol: TCP` and `protocol: UDP` for port 443.

---

## 2. QUIC packet capture visibility

**Symptom:** tcpdump shows TCP 443: N, UDP 443: 0; “no QUIC packets”.

**Cause:** Capture runs **inside** the Caddy pod. Traffic is seen as **node/pod IP**, not the MetalLB LB IP. A filter like `host ${TARGET_IP} and port 443` matches nothing inside the pod.

**Fix:** Use a **port-only** filter so in-pod tcpdump sees both TCP and UDP 443:

- Filter: `tcp port 443 or udp port 443` (no `host`).
- In `scripts/test-microservices-http2-http3.sh`, `CADDY_CAPTURE_FILTER` is set to this port-only form so MetalLB and NodePort both show QUIC when present.

---

## 3. k6 chaos job exit 107

**Symptom:** k6 job exits 107; `kubectl -n k6-load describe pod <pod>` shows `OOMKilled`.

**Cause:** 500 req/s for 90s under Colima with many pods can exceed default memory.

**Fix:**

- Job already has `resources.limits.memory: 1Gi` in `scripts/run-k6-chaos.sh`.
- If still OOMKilled, raise in the job YAML (e.g. `1.5Gi` or `2Gi`) or set `CHAOS_LOW_START_RATE=1` to lower rate.
- Optional: `CHAOS_CPU_GUARDRAIL=1` skips starting chaos when node CPU/memory is above threshold.

---

## 4. In-cluster Caddy curl “executable not found”

**Symptom:** `exec: "curl": executable file not found` when some path runs curl inside a pod.

**Cause:** The Caddy image (and some others) do not include `curl`. If a script exec’s into Caddy to run curl, it fails.

**Fix:**

- The main in-cluster Caddy check (`scripts/verify-caddy-strict-tls-in-cluster.sh`) uses a **separate** pod with `curlimages/curl`, so it does not depend on Caddy having curl.
- If another path exec’s into Caddy (or another image without curl) and fails, either:
  - Use that path only from host (LB IP or NodePort), or
  - Set `SKIP_IN_CLUSTER_CURL=1` when running MetalLB verify so the in-cluster Caddy curl step is skipped.
- Cosmetic: not a platform failure; host or dedicated curl-pod checks are sufficient.

---

## 5. HAProxy 503 during rotation

**Symptom:** HAProxy returns 503 during CA rotation (e.g. after restarting auth-service, records-service, …).

**Cause:** HAProxy can route to api-gateway endpoints before they are ready after restarts.

**Fix:**

- HAProxy config already has:
  - `option httpchk GET /healthz`
  - `http-check expect status 200`
  - `default-server inter 3s fall 2 rise 3`
- So it only sends traffic to ready pods; 503 should be brief. If 503 persists, ensure api-gateway pods are Ready and that `/healthz` returns 200; restart HAProxy if needed after backends are stable.

---

## Summary

| Item                         | Status / action                                                                 |
|-----------------------------|----------------------------------------------------------------------------------|
| UDP 443 on Caddy Service    | Use `caddy-h3-service-loadbalancer.yaml` and `caddy-h3-deploy-loadbalancer.yaml` |
| Caddy HTTP/3                | Caddyfile has `servers { protocols h1 h2 h3 }` — no change needed                |
| Packet capture (QUIC)       | Filter by port only: `tcp port 443 or udp port 443` (no `host`)                  |
| k6 exit 107                 | Job has `memory: 1Gi`; increase if still OOMKilled                              |
| Caddy in-cluster curl       | Use dedicated curl pod or `SKIP_IN_CLUSTER_CURL=1`                               |
| HAProxy 503 in rotation     | `default-server inter 3s fall 2 rise 3` + httpchk; restart after backends ready  |
