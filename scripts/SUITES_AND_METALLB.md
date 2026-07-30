# Test Suites Pipeline and MetalLB Script Map

## Full pipeline: all 8 suites

The single entry point that runs **preflight then all 8 test suites** is:

```bash
./scripts/run-preflight-scale-and-all-suites.sh
```

- **Step 7** of preflight invokes `run-all-test-suites.sh` (with `SKIP_PREFLIGHT=1` so it doesn’t run preflight again).
- **run-all-test-suites.sh** runs the 8 suites in order. A failed suite increments `FAILED` and appends to `FAILED_SUITES` but **does not stop** the run; all 8 suites are executed. So if baseline (2/8) fails, enhanced (3/8) through social (8/8) still run.

### Suite order (1/8 → 8/8)

| # | Suite            | Script                                      |
|---|------------------|---------------------------------------------|
| 1 | auth             | `test-auth-service.sh`                      |
| 2 | baseline         | `test-microservices-http2-http3.sh`         |
| 3 | enhanced         | `test-microservices-http2-http3-enhanced.sh`|
| 4 | adversarial      | `enhanced-adversarial-tests.sh`             |
| 5 | rotation         | `rotation-suite.sh`                         |
| 5b| k6 (optional)    | `load/run-k6-phases.sh` (when RUN_K6=1)     |
| 6 | standalone-capture | `test-packet-capture-standalone.sh`        |
| 7 | tls-mtls         | `test-tls-mtls-comprehensive.sh`             |
| 8 | social           | `test-messaging-service-comprehensive.sh`       |

After each suite, `verify-db-cache-quick.sh` runs. Suite logs go to `SUITE_LOG_DIR` (e.g. `bench_logs/preflight-<timestamp>/suite-logs/`).

### Why baseline (2/8) might have “not run” the tests

Baseline uses `set -e`. It used to run `kubectl exec deploy/postgres -- psql ...` for an optional auth DB check. With **external Postgres** (e.g. k3d, no in-cluster postgres), that command fails and the script exited immediately; the only thing that ran on exit was the EXIT trap (packet capture stop), so it looked like “no tests ran”.

**Fix (already applied):** The K8s postgres check only runs if `deploy/postgres` exists; otherwise it’s skipped. Baseline now continues past the DB check and runs the full test set. Re-run the pipeline to confirm.

---

## MetalLB: two aspects

MetalLB is used so Caddy gets a LoadBalancer IP (e.g. `192.168.106.240`). There are two separate concerns in the scripts.

### Aspect 1: Install and verify (cluster-side)

- **Preflight step 3c1:** Install MetalLB and apply pool + L2 advertisement.
- **Preflight step 3c1b:** Run the “thorough” MetalLB verification.

Relevant scripts:

| Script | Purpose |
|--------|--------|
| `install-metallb.sh` | Install MetalLB (manifests). |
| `install-metallb-chunked.sh` | Chunked install (retries). |
| `install-metallb-when-stable.sh` | Install after API is stable. |
| `apply-metallb-pool-and-caddy-service.sh` | Apply IP pool + L2Advertisement + Caddy LoadBalancer. |
| **`verify-metallb-and-traffic-policy.sh`** | **Main verify:** controller/speaker, pool, L2Advertisement, LB services, in-cluster Caddy, host reachability (step 5), HTTP/3 (step 6). Writes **`/tmp/metallb-reachable.env`** with `USE_LB_FOR_TESTS=1` and `REACHABLE_LB_IP=<ip>` when host can reach the LB IP. |
| `verify-metallb-advanced.sh` | BGP / route flaps / advanced checks. |
| `verify-metallb-colima-l2-only.sh` | Colima-only L2 verification. |
| `ensure-colima-metallb-for-l2.sh` | Ensure MetalLB on Colima for L2. |

Preflight (with `METALLB_ENABLED=1`) runs the install and then **verify-metallb-and-traffic-policy.sh**. That script also runs **setup-lb-ip-host-access.sh** (see Aspect 2) when the host cannot reach the LB IP yet.

### Aspect 2: Host reachability (LB IP from your machine)

On k3d, the LB IP is only routable inside Docker. To use it from the **host** (and for HTTP/3), we use a loopback alias and socat forwarders.

| Script | Purpose |
|--------|--------|
| **`setup-lb-ip-host-access.sh`** | **Main setup:** add LB IP as loopback alias; socat TCP 443 and UDP 443 → `127.0.0.1:NODEPORT` (30443); optional Docker bridge `0.0.0.0:18443` → NodePort for HTTP/3 from containers. Requires `socat` and sudo. |
| `stop-lb-ip-host-access.sh` | Tear down alias and socat (and optional Docker bridge). |
| `fix-http3-lb-ip-reset.sh` | Reset/fix UDP 443 binding (e.g. “Address already in use”). |
| `diagnose-http3-lb-ip-under-the-hood.sh` | Diagnose HTTP/3 via LB IP (tcpdump, socat logs). |

**HTTP/3 paths (MetalLB IP, socat, NodePort, Docker bridge):**
- **Primary:** MetalLB LB IP (e.g. 192.168.106.240) is the intended target for all host traffic. `setup-lb-ip-host-access.sh` adds a loopback alias and **socat** forwards TCP 443 and UDP 443 on that IP to `127.0.0.1:NODEPORT` (30443), so `https://record.local` (resolved to LB IP) works for HTTP/1.1, HTTP/2, and HTTP/3.
- **Socat:** UDP 443 → NodePort is required for HTTP/3 via LB IP. Socat runs with `fork` so one child per client and reply packets from Caddy are routed back correctly. If HTTP/3 via LB IP fails but NodePort direct works, it is often a macOS/Docker UDP quirk; the suite then uses NodePort or Docker bridge for HTTP/3.
- **NodePort:** Direct `127.0.0.1:30443` (with `--resolve record.local:30443:127.0.0.1`) is the fallback when LB IP UDP path fails; preflight 4e verifies this.
- **Docker bridge:** `host.docker.internal:18443` (socat on host listening on 0.0.0.0:18443 → NodePort) is used when running HTTP/3 from **inside** a container (e.g. k6 in-cluster) so traffic does not use the host’s loopback alias.

**HTTP/3 and `scripts/lib/http3.sh`:** The baseline (and other suites) source `lib/http3.sh` for `http3_curl`. When native curl to the LB IP fails (e.g. host↔NodePort UDP limit on macOS), the script can use the **Docker bridge** (`host.docker.internal:18443`) or **127.0.0.1:18443** (host socat). See `docs/K3D_METALLB_INGRESS_EGRESS.md` and `docs/RCA-HTTP3-CURL-EXIT-28.md`.

### How the two aspects connect

1. **Preflight (3c1b)** runs `verify-metallb-and-traffic-policy.sh`, which checks host reachability and, if needed, runs `setup-lb-ip-host-access.sh` (Aspect 2).
2. **verify-metallb-and-traffic-policy.sh** writes **`/tmp/metallb-reachable.env`** when the host can use the LB IP (after setup).
3. **run-all-test-suites.sh** sources that file and sets `TARGET_IP`, `PORT=443`, and uses the LB IP for all suites; if the LB IP is still unreachable it falls back to NodePort or port-forward.

So: **Aspect 1** (install + verify) ensures MetalLB and Caddy have an external IP and that the host path is set up; **Aspect 2** (setup/stop/diagnose) is what makes the LB IP and HTTP/3 work from your machine.

---

## Quick reference: key scripts

| Goal | Script |
|------|--------|
| Run everything (preflight + all 8 suites) | `run-preflight-scale-and-all-suites.sh` |
| Run only the 8 suites (cluster already up) | `SKIP_PREFLIGHT=1 SKIP_FULL_PREFLIGHT=1 ./scripts/run-all-test-suites.sh` |
| **k3d 2-node + registry + MetalLB + HTTP/3 status** | **`k3d-status-and-http3-debug.sh`** (nodes, 127.0.0.1:5000, Caddy, socat, HTTP/3 path checklist) |
| MetalLB install + verify (preflight does this when METALLB_ENABLED=1) | `verify-metallb-and-traffic-policy.sh` |
| Make LB IP work from host (alias + socat + Docker bridge) | `setup-lb-ip-host-access.sh` |
| Tear down LB IP host access | `stop-lb-ip-host-access.sh` |
| HTTP/3 helpers (used by baseline/enhanced) | `lib/http3.sh` |
| Baseline smoke (HTTP/2 + HTTP/3 + capture) | `test-microservices-http2-http3.sh` |
| **2-node + registry + MetalLB + HTTP/3 debug (k3d)** | **`k3d-status-and-http3-debug.sh`** |

### Registry (127.0.0.1:5000) not reachable

Preflight step 2e checks that the k3d registry is up and has required app images. The registry is **created and bound to 127.0.0.1:5000** when you run **`./scripts/k3d-registry-push-and-patch.sh`** (it creates the registry container if missing and pushes `:dev` images). So:

1. Start the cluster: `k3d cluster start record-platform` (or create it with `./scripts/k3d-create-2-node-cluster.sh`).
2. Run `./scripts/k3d-registry-push-and-patch.sh` so the registry exists and 127.0.0.1:5000 is reachable.

Then preflight’s image check can pass. To see current status (nodes, registry, MetalLB, HTTP/3): **`./scripts/k3d-status-and-http3-debug.sh`**.

---

See also: `RUN-PREFLIGHT.md`, `docs/K3D_METALLB_INGRESS_EGRESS.md`, `docs/RCA-HTTP3-CURL-EXIT-28.md`.
