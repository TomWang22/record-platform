# Running Test Suites

**`run-suites-separately.sh`** and **`preflight-fix-kubeconfig.sh`** set **`PATH`** with **`scripts/shims` first** so `kubectl` uses the shim (avoids "shim not active" and API server timeouts). If you still see "API server not ready" or "kubectl shim not active", see **`API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md`** for the one-command quick fix and verification steps.

---

## Colima + k3s: API server reachable

If you use **Colima + k3s**, ensure the API server is reachable so tests don’t hang:

- **Recommended:** `colima start --with-kubernetes` **(no `--network-address`)**, kubeconfig → `https://127.0.0.1:6443`.
- If you use `--network-address`, run `ssh -L 6443:127.0.0.1:6443 colima` and point kubeconfig at `127.0.0.1:6443`.

Preflight forces Colima server to `127.0.0.1:6443` when context is Colima. See **`COLIMA-K8S-FIX.md`** and **`API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md`** (kubeconfig, shims-first PATH, API server checks).

---

## Colima + k3s: full pipeline (scale, TLS, pods, then all 5 suites)

**One command** to fix reachability, scale to baseline, verify strict TLS, check pods/DB/Redis, then run all 5 suites:

```bash
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
./scripts/run-preflight-scale-and-all-suites.sh
```

This will:

1. **Preflight** kubeconfig (Colima → `127.0.0.1:6443`, Kind port).
2. **Trim** Failed/Succeeded pods (reduces API load).
3. **Ensure** API server ready.
4. **Scale**: service pods 1, exporters 1, Envoy 1 (`envoy-test`), Caddy 2 (`ingress-nginx`).
5. **Strict TLS** check (CA + leaf for all 9 services).
6. **Pod/DB/Redis** check (8 Postgres, Redis + Lua, TLS secrets).
7. **All 5 suites**: Baseline → Enhanced → Adversarial → Rotation → Standalone capture.

Use `RUN_SUITES=0` to run only 1–6 (no suites). After all 5 pass, run **k6** constant then limit tests.

---

## Run all suites (full)

```bash
./scripts/run-all-test-suites.sh
```

Runs, in order: **1** Baseline → **2** Enhanced → **3** Adversarial → **4** Rotation → **5** Standalone capture.

## Run suites separately

```bash
./scripts/run-suites-separately.sh           # all (1–5)
./scripts/run-suites-separately.sh 1         # baseline only
./scripts/run-suites-separately.sh 2         # enhanced only
./scripts/run-suites-separately.sh 3 4 5     # adversarial, rotation, standalone
```

- **1 – Baseline:** full smoke test + packet capture (gRPC, HTTP/2, HTTP/3).
- **2 – Enhanced:** smoke test + adversarial + per-test and global packet capture.
- **3 – Adversarial:** DB disconnect, cache, packet capture, protocol-under-load.
- **4 – Rotation:** CA/leaf rotation + wire-level capture (Caddy + Envoy).
- **5 – Standalone capture:** gRPC + HTTP/2 + HTTP/3 traffic, capture, analyze only.

## When the cluster isn’t ready

If the cluster (e.g. Kind/Colima) isn’t up, **1–4** may hang on API/server checks. Use:

```bash
SKIP_API_CHECK=1 ./scripts/run-suites-separately.sh 5
```

**5** will do a quick cluster check and exit with a clear message if the cluster isn’t reachable, instead of hanging.

## Protocol coverage

- **gRPC:** Envoy (ports 50051–50060, 10000, 30000/30001); captured on Envoy pods.
- **HTTP/2:** Caddy TCP 443, NodePort 30443; captured on Caddy pods.
- **HTTP/3 / QUIC:** Caddy UDP 443; captured on Caddy pods.

All suites use the shared packet-capture lib (`scripts/lib/packet-capture.sh`) where applicable.
