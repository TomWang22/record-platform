# k3d Preflight and Test Suites — Wire-Level Investigation

**Purpose:** Root-cause analysis for failures when running preflight and all test suites on k3d (REQUIRE_COLIMA=0). Fixes applied and how to verify.

---

## 1. Summary of failures (from run logs)

| Symptom | Cause | Fix |
|--------|--------|-----|
| Caddy in-cluster verify failed after 3 attempts | Script read HTTP code via `kubectl exec` on a **terminated** pod; exec is not allowed on stopped containers, so we got empty/000 | Verify script now prints `HTTP_CODE:<code>` to stdout and we read via `kubectl logs` (works for terminated containers) |
| Auth suite: Health check failed - HTTP (empty), Registration failed - HTTP (empty), curl exit 7 | Host cannot reach Caddy: on k3d the MetalLB LB IP (e.g. 172.18.0.241) is in the Docker network and not routable from the host; PORT default 30443 (NodePort) also not listening on host | **run-all-test-suites.sh** starts a Caddy **port-forward** (8443:443) when context is k3d and exports PORT=8443 so all curls use `--resolve record.local:8443:127.0.0.1` and hit 127.0.0.1:8443 |
| Baseline: TLS pre-flight curl failed (exit 7), Caddy/API Gateway health failed, curl exit 7 | Same: no host reachability to Caddy on k3d | Same port-forward; baseline uses PORT and --resolve in test-microservices-http2-http3.sh |
| Reissue: "Secret type is immutable" (record-local-tls, then service-tls) | Kubernetes Secret `type` is immutable; apply with a different type (e.g. Opaque vs kubernetes.io/tls) fails | Reissue script **deletes** the secret in the relevant namespace(s) before apply, so the apply is a create with the desired type |
| Preflight hung after reissue failure | Long connection-reset diagnostic ran (Colima-focused) and had no timeout | Diagnostic only runs when context is Colima; on k3d we skip it; on Colima we run it with a 15s timeout |
| HTTP/3 tests: curl exit 7 on k3d | QUIC/HTTP/3 uses **UDP**. With TCP-only port-forward (8443) there is no UDP; with **NodePort 30443** published to the host, both TCP and UDP work | **Fix:** (1) Caddy service: `https-udp` port has `nodePort: 30443` (same as TCP). (2) k3d: create cluster with `--port 30443:30443@server:0`. (3) run-all-test-suites.sh: on k3d, try NodePort 30443 first; if reachable use PORT=30443 (HTTP/2+HTTP/3). Else fall back to port-forward 8443 (HTTP/2 only). **Existing clusters:** `k3d cluster edit record-platform --port-add 30443:30443@server:0` then apply `infra/k8s/caddy-h3-service-nodeport.yaml` (delete svc first if UDP had a different nodePort); or recreate with `scripts/k3d-create-2-node-cluster.sh` |
| gRPC Shopping (or other) HealthCheck: 502 Bad Gateway from port-forward | API server (127.0.0.1:6443) cannot dial the node’s kubelet (e.g. 172.20.0.4:10250); often transient or node load | Script now prints a hint. Check node/pod status; retry; if persistent, investigate kubelet/API server connectivity |

---

## 2. Wire-level explanation

### 2.1 Host → Caddy on k3d

- **Colima:** The VM’s network is often bridged so the host can reach the MetalLB LB IP or NodePort (e.g. 127.0.0.1:30443 with tunnel).
- **k3d:** Nodes run in Docker; the LoadBalancer IP (e.g. 172.18.0.241) is on the k3d Docker network. The host is not on that network, so **curl from the host to that IP (or to record.local resolving to it) fails with “connection refused” or timeout (curl exit 7)**. NodePort (30443) is bound on the node’s IP (inside Docker), so the host also cannot reach it unless there is an explicit port publish or proxy.

So for **host-run** test suites (auth, baseline, etc.) to hit Caddy on k3d we must:

1. **Port-forward** from the host to the Caddy service: `kubectl port-forward -n ingress-nginx svc/caddy-h3 8443:443`.
2. Use **PORT=8443** and **--resolve record.local:8443:127.0.0.1** so all curls go to 127.0.0.1:8443.

**run-all-test-suites.sh** now does (1) and (2) when `ctx` is k3d.

### 2.2 In-cluster Caddy verify

- A one-off Pod curls `https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz` with `dev-root-ca`; no host reachability needed.
- The script previously wrote the HTTP code to `/tmp/code` in the container and then ran **`kubectl exec ... cat /tmp/code`**. For a Pod with `restartPolicy: Never`, the container **exits** and becomes **terminated**; **exec is not allowed on terminated containers**, so the exec failed or returned nothing and we treated the result as 000.
- **Fix:** The container now echoes `HTTP_CODE:<code>` to **stdout**. After the pod completes we use **`kubectl logs`** (which works for terminated containers) and parse the code. No exec needed.

### 2.3 Secret type immutable

- Reissue applies Secrets with `type: Opaque`. If a Secret already exists with a different type (e.g. `kubernetes.io/tls`), the API rejects the update with “field is immutable”.
- **Fix:** Before applying `record-local-tls` or `service-tls`, the reissue script **deletes** that Secret in the relevant namespace(s), then applies. The apply is then a **create** with the desired type.

### 2.4 HTTP/3 (QUIC) on k3d — fixed

- **QUIC/HTTP/3** uses **UDP** on port 443. **kubectl port-forward** is TCP-only, so a port-forward to 8443 gives no UDP and HTTP/3 fails (curl exit 7).
- **Fix:** Use **nodePort 30443** for Caddy so the host can reach both TCP and UDP:
  1. **Caddy Service:** Both **NodePort** (`caddy-h3-service-nodeport.yaml`) and **LoadBalancer** (`caddy-h3-service.yaml`) manifests set **nodePort: 30443** for `https` (TCP) and `https-udp` (UDP). With METALLB_ENABLED=1 preflight applies the LoadBalancer service; if the existing service had a different nodePort (immutable), preflight deletes the service then re-applies so 30443 is set.
  2. **k3d cluster:** Port **30443** must be published for **both TCP and UDP**. k3d `--port` defaults to TCP only; add `--port 30443:30443/udp@server:0` for QUIC. **Recommended:** create the cluster with `./scripts/k3d-create-2-node-cluster.sh` (includes `--port 30443:30443@server:0` and `--port 30443:30443/udp@server:0`). **Avoid** `k3d cluster edit --port-add` in existing clusters (replaces serverlb, can break API). **Existing clusters:** recreate to get UDP 30443.
  3. **run-all-test-suites.sh**: On k3d, **probe TCP** 127.0.0.1:30443; if 200, **probe HTTP/3** (one QUIC request). Only if both pass, claim "HTTP/2 + HTTP/3/QUIC work"; else "HTTP/2 only" and hint to recreate cluster for HTTP/3.
- **Existing k3d clusters (no 30443):** **Safest:** recreate with `k3d cluster delete record-platform` then `./scripts/k3d-create-2-node-cluster.sh`. **Or** run `./scripts/k3d-fix-30443-or-recover.sh` to see what is using ports and get recovery steps; if you try `k3d cluster edit --port-add` manually and get "address already in use", free that port first or recreate the cluster. After a failed edit, try `k3d cluster stop record-platform && k3d cluster start record-platform` to recover API server.

### 2.5 gRPC port-forward 502 Bad Gateway

- When the baseline runs **gRPC HealthCheck** it does a **pod** port-forward (e.g. to shopping-service’s 50058) and then runs grpcurl. The port-forward goes through the **API server**, which connects to the **node’s kubelet** to attach to the pod. If that dial fails (e.g. kubelet overloaded, network blip), you see **502 Bad Gateway** and “error dialing backend”.
- This is a **cluster-internal** issue (API server ↔ kubelet), not the test script. The script now adds a one-line hint when 502 appears so you know to check node/pod health or retry.

---

## 3. Script changes (reference)

| Script | Change |
|--------|--------|
| `scripts/verify-caddy-strict-tls-in-cluster.sh` | Container echoes `HTTP_CODE:$code` to stdout; script reads result via `kubectl logs` and parses with `grep -o 'HTTP_CODE:[0-9]*' \| cut -d: -f2`. |
| `scripts/run-all-test-suites.sh` | When `ctx` is k3d: probe TCP 127.0.0.1:30443; if 200, probe HTTP/3 (QUIC). If both pass, PORT=30443 and "HTTP/2+HTTP/3". Else PORT=30443 with "HTTP/2 only" and hint to recreate cluster for UDP 30443. If TCP fails, port-forward 8443 (HTTP/2 only). Trap EXIT to kill port-forward when used. |
| `scripts/reissue-ca-and-leaf-load-all-services.sh` | Before apply: delete `record-local-tls` in record-platform and ingress-nginx; delete `service-tls` in record-platform. |
| `scripts/run-preflight-scale-and-all-suites.sh` | On reissue failure: run connection-reset diagnostic only when context is Colima; when Colima, run diagnostic with 15s timeout to avoid hanging. Step 7 logs k3d port-forward note. |
| `scripts/test-auth-service.sh` | Logs target (HOST:PORT). On health/registration failure: if HTTP code empty or curl non-zero, logs “connection error (curl exit N). Check HOST/PORT and port-forward.” Optional AUTH_TEST_VERBOSE=1 for per-request logging. |
| `scripts/test-microservices-http2-http3.sh` | When k3d and PORT=8443, sets K3D_TCP_PORT_FORWARD_ONLY=1 and logs that HTTP/3 will fail until cluster has 30443 published. grpc_test_strict_tls: when port-forward exits with 502, prints hint “API server could not reach node kubelet; check node/pod status”. |

---

## 4. How to verify

1. **In-cluster Caddy verify**  
   Run: `./scripts/verify-caddy-strict-tls-in-cluster.sh`  
   Expect: “Caddy strict TLS OK in-cluster (HTTP 200, no port-forward)”.

2. **Host suites on k3d**  
   Use k3d context, then run suites (e.g. from preflight or directly):  
   `kubectl config use-context k3d-record-platform`  
   `REQUIRE_COLIMA=0 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh`  
   Or: `REQUIRE_COLIMA=0 SKIP_FULL_PREFLIGHT=1 ./scripts/run-all-test-suites.sh`  
   Suites should see PORT=8443 and the port-forward; auth and baseline curls should reach Caddy (no exit 7 from “couldn’t connect”).

3. **Reissue**  
   Run preflight with reissue (default). Expect no “Secret type is immutable” errors; reissue should complete and Caddy/ingress-nginx should have updated certs.

4. **MetalLB**  
   After preflight: `./scripts/verify-metallb-and-traffic-policy.sh`  
   Optionally with in-cluster Caddy check (default): same script; in-cluster verify may now pass if Caddy is healthy.

5. **HTTP/3 on k3d**  
   After applying the Caddy service change (nodePort 30443 for UDP) and recreating the cluster with the updated `k3d-create-2-node-cluster.sh` (which publishes 30443), run preflight/suites. run-all-test-suites.sh will detect 127.0.0.1:30443 and use PORT=30443; **HTTP/2 and HTTP/3** should both pass. If the cluster was created before the port was published, only HTTP/2 works (port-forward 8443); recreate the cluster to get HTTP/3.

6. **gRPC 502**  
   If a gRPC HealthCheck (e.g. shopping) shows “502 Bad Gateway”, the script hints to check node/pod status. Retry the suite; if it persists, inspect the node and kubelet.

---

## 5. Related docs

- **docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md** — k3d flow, preflight, Caddy verify, MetalLB.
- **docs/adr/009-k3d-default-local-cluster.md** — k3d as default local cluster, REQUIRE_COLIMA=0, in-cluster verify.
- **scripts/test-microservices-http2-http3.sh** — Uses PORT and `--resolve "$HOST:${PORT}:127.0.0.1"`; with PORT=8443 and port-forward, host curls succeed on k3d.
