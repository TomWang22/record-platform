# API Server "Not Ready" — Fix Once and For All

**Date:** 2026-01  
**Status:** Troubleshooting guide + **fix applied** (preflight/ensure caps, trim).  
**Applies to:** Kind h3, Colima + k3s, `run-suites-separately.sh`, `run-preflight-scale-and-all-suites.sh`, baseline/enhanced smoke tests

**Fix applied:** `PREFLIGHT_CAP` was 12 or 10 in several places, but preflight needs **≥ 25s** (Kind 10s + verify 15s). The process was always killed before verify finished → "timed out" every time. Defaults are now **30** everywhere. A **trim-completed-pods** step runs after preflight when reachable to delete Failed/Succeeded pods and reduce API server load.

---

## 1. What You're Seeing

When running `./scripts/run-suites-separately.sh` or the baseline smoke tests:

```
⚠️  kubectl shim not active - timeout issues possible

=== Pre-flight: Fix kubeconfig (Colima 127.0.0.1:6443, Kind port) ===
Cluster "kind-h3" set.
Kind h3 port -> 57122
✅ Cluster reachable

--- 1: Baseline smoke ---
⚠️  kubectl shim not active - timeout issues possible
...
=== Ensuring Kubernetes API server is ready ===
✅ Cluster reachable
⚠️  API server not ready (attempt 1/5), waiting 2s...
```

So:

- **Pre-flight** says **Cluster reachable**.
- Right after, **ensure-api-server-ready** says **API server not ready** and retries.
- **kubectl shim** warns it’s **not active**.

This doc explains why that happens and how to fix it **without touching repo code** — only env, PATH, and manual checks.

---

## 2. Why "Cluster reachable" but "API server not ready"?

Two different checks run in sequence:

| Check | Script | What it uses | When it runs |
|-------|--------|--------------|--------------|
| **Pre-flight** | `preflight-fix-kubeconfig.sh` | Raw `kubectl` (or `docker exec` / `colima ssh` fallbacks), `--request-timeout=5s` | Once at start, then again per suite |
| **API server ready** | `ensure-api-server-ready.sh` | `kubectl-helper` (kctl) or `kubectl` | Right after pre-flight, inside each test script |

So:

1. **Pre-flight** fixes kubeconfig (Kind port, Colima → `127.0.0.1:6443`), then runs `kubectl get nodes` (or fallbacks). That often **succeeds** → "Cluster reachable".
2. **Ensure-api-server-ready** runs **immediately after**, using `_kubectl` (kctl or plain kubectl). It can **fail** if:
   - **PATH**: The `kubectl` (or kctl’s underlying `kubectl`) that runs is different from what pre-flight used (e.g. no shim, different timeout behaviour).
   - **Timeouts**: Retries use `KUBECTL_REQUEST_TIMEOUT` (default 10s in ensure) but the **first** attempt can still hit a slow or flaky API server.
   - **Flakiness**: Cluster is under load, API server is briefly slow, or Docker/Kind port mapping flickers.

So you can get **"Cluster reachable"** then **"API server not ready"** without anything obviously broken — different code paths and timing.

---

## 3. Why "kubectl shim not active"?

The **kubectl shim** (`scripts/shims/kubectl`) adds timeouts, Kind port fixes, and fallbacks. It only works when it’s the **first** `kubectl` in `PATH`.

- `run-suites-separately.sh` sets `PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"` **before** sourcing `ensure-kubectl-shim.sh`.
- If your incoming `PATH` was e.g. `scripts/shims:...`, shims end up **after** Homebrew. So `kubectl` resolves to the **real** kubectl, not the shim.
- `ensure-kubectl-shim.sh` only checks that `scripts/shims` is **somewhere** in `PATH` and prepends it if missing. It does **not** guarantee shims are **first**. So you can still have homebrew first → "kubectl shim not active".

**Bottom line:** Whenever shims aren’t **first** in `PATH`, you get that warning and no timeout/fallback benefits from the shim.

---

## 4. Resolution Checklist (No Code Changes)

Do these in order. Everything is **environment and manual steps** only.

### 4.1 Use the right kubeconfig

- **Kind h3:** Use the kubeconfig that points at your Kind cluster (e.g. from `kind get kubeconfig --name h3` or `KUBECONFIG=/tmp/kind-h3.yaml`).
- **Colima:** Use the context that uses `https://127.0.0.1:6443` (no `--network-address`).  
  See `GUARANTEED-KUBECTL-FIX.md` and `COLIMA-K8S-FIX.md` for Colima specifics.

```bash
# Check current context and server
kubectl config current-context
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

### 4.2 Put shims first in PATH **before** running the script

So that **both** pre-flight and ensure-api-server-ready use the shim:

```bash
cd /path/to/record-platform
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
```

Then run your suites **in the same shell**:

```bash
./scripts/run-suites-separately.sh 1 2 3 4 5
```

**Verify shim is active:**

```bash
command -v kubectl
# Must show: .../record-platform/scripts/shims/kubectl
```

If it shows `/opt/homebrew/bin/kubectl` (or similar), shims are still not first — fix `PATH` and try again.

### 4.3 Ensure pre-flight can fix Kind port

Pre-flight runs `docker port h3-control-plane 6443/tcp` and updates kubeconfig. For that to work:

- Kind cluster **h3** must exist and the control-plane container must be running.
- **Docker** must be reachable (`docker ps` works).

```bash
docker ps --format '{{.Names}}' | grep h3-control-plane
docker port h3-control-plane 6443/tcp
```

If the port is **not** 6443 (e.g. 57122), pre-flight will set the cluster server to `https://127.0.0.1:<port>`. Your kubeconfig must be the one pre-flight updates (e.g. default `~/.kube/config` or `KUBECONFIG` you set).

### 4.4 Give the API server time to settle

If the cluster or control-plane just started, the API server can be slow for a few seconds.

- **After `kind create cluster` or `docker start h3-control-plane`:** wait 10–20s, then run the suites.
- **Optional:** increase retries for the "API server ready" check:

```bash
export API_SERVER_MAX_ATTEMPTS=10
export API_SERVER_SLEEP=3
./scripts/run-suites-separately.sh 1 2 3 4 5
```

(No code change — these env vars are already respected by `ensure-api-server-ready.sh`.)

### 4.5 Skip the API server check only when debugging

If you’ve verified the cluster works (e.g. `kubectl get nodes` is fine) and you only want to avoid the "API server not ready" retries:

```bash
SKIP_API_CHECK=1 ./scripts/run-suites-separately.sh 5
```

Use sparingly; the check is there to avoid running tests against an unreachable API.

### 4.6 Kind-specific: control-plane load and restarts

From `Runbook.md`:

- **API server overload** (mass deletes, big rollouts, heavy load) can make it temporarily unreachable.
- **Restarting the control-plane** can change the host port for 6443 (e.g. 57122 → another port). Pre-flight will fix it **only if** it runs **after** the restart and you’re using the kubeconfig it updates.

If you keep seeing "API server not ready" only under load:

- Avoid mass operations (e.g. `kubectl delete pod --all`) or scale down first.
- Restart the control-plane if the API server is wedged:  
  `docker restart h3-control-plane` then wait ~15s, then run pre-flight/suites again.

### 4.7 Colima-specific: use 127.0.0.1:6443, not VM IP

- **Do not** use `--network-address` if you care about stable API access. Use `colima start --with-kubernetes` (no `--network-address`).
- Ensure kubeconfig uses `https://127.0.0.1:6443`. Pre-flight does this for Colima contexts; avoid overwriting it with a VM IP.

See `COLIMA-K8S-FIX.md` and `GUARANTEED-KUBECTL-FIX.md` (Colima 127.0.0.1:6443, no `--network-address`) for more detail.

---

## 5. Verification Commands

Run these **before** `run-suites-separately.sh`:

```bash
# 1. Shim active
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v kubectl
# Expect: .../scripts/shims/kubectl

# 2. Kind control-plane up
docker ps --format '{{.Names}}' | grep -q h3-control-plane && echo "Kind h3 up" || echo "Kind h3 down"

# 3. Kind API port
docker port h3-control-plane 6443/tcp

# 4. Cluster reachable (pre-flight–style check)
kubectl get nodes --request-timeout=10s && echo "Cluster reachable" || echo "Cluster NOT reachable"

# 5. Optional: ensure-api-server-ready–style check
KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=5 API_SERVER_SLEEP=2 \
  ./scripts/ensure-api-server-ready.sh
```

If 1–4 succeed but 5 still fails intermittently, use **4.4** (more attempts/sleep) or **4.5** (skip when you’ve confirmed reachability).

---

## 6. One-Command Quick Fix (Kind h3)

From repo root, **same shell**:

```bash
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
# Optional: higher retries for API server check
export API_SERVER_MAX_ATTEMPTS=10
export API_SERVER_SLEEP=3

./scripts/preflight-fix-kubeconfig.sh || true
./scripts/run-suites-separately.sh 1 2 3 4 5
```

Adjust `KUBECONFIG` if you use a dedicated Kind kubeconfig (e.g. `/tmp/kind-h3.yaml`).

---

## 7. No-hang guarantees (script behaviour)

- **Pre-flight:** Entire script is capped at `PREFLIGHT_CAP` seconds (default **30**). Kind fix uses 10s, verify 15s (sequential), so the cap **must be ≥ 25** or preflight is killed before verify completes — that was the root cause of "timed out". It never blocks indefinitely.
- **Ensure-api-server-ready:** Runs preflight with `PREFLIGHT_CAP=30` then waits for the API server; the wait loop is capped at `ENSURE_CAP` seconds (default **30**). Uses `API_SERVER_MAX_ATTEMPTS=5`, `API_SERVER_SLEEP=2` when invoked from runner/baseline/enhanced.
- **Trim completed pods:** When preflight succeeds, `trim-completed-pods.sh` deletes Failed and Succeeded pods cluster-wide (capped at `TRIM_CAP` default 15s) to reduce API server load. Run only when cluster is reachable.
- **Kubectl shim / kubectl-helper:** `docker port` for Kind is capped at 5s so it never hangs.
- **Packet capture:** All `kubectl exec` calls use `--request-timeout=15s` (override via `KUBECTL_EXEC_TIMEOUT`).

---

## 8. Research: non‑invasive diagnostics (read‑only)

**Purpose:** Figure out what’s going on **without** changing any code or running the failing script. Use when you see **"Cluster not reachable or preflight timed out"** or **"API server check capped or failed"** from `run-preflight-scale-and-all-suites.sh` (or similar). Scripts now use `PREFLIGHT_CAP=30` and `ENSURE_CAP=30` by default; if you still see timeouts, these checks help.

Run these in the **same** environment you use for that script (same terminal, same PATH, same Docker/Colima state). All checks are read‑only: no `apply`, `scale`, `delete`, or restarts.

### 8.1 Tooling in PATH

```bash
command -v docker && echo "docker OK" || echo "docker NOT FOUND"
command -v kubectl && echo "kubectl OK" || echo "kubectl NOT FOUND"
command -v colima && echo "colima OK" || echo "colima NOT FOUND"
```

**What to look for:** Preflight uses `docker` (Kind) and/or `colima` (Colima). If either is missing from PATH when the script runs, those fallbacks never run and you get "Cluster not reachable" even when the cluster is up.

### 8.2 Kind: control-plane and API port

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'h3|control-plane'
docker port h3-control-plane 6443/tcp
```

**What to look for:** (1) `h3-control-plane` exists and is `Up`. (2) `6443/tcp -> 0.0.0.0:XXXXX` — the host port (`XXXXX`) is what kubeconfig must use. If the container isn’t running, port fix and verify both fail.

### 8.3 Kubeconfig: context and server

```bash
kubectl config current-context
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
echo ""
```

**What to look for:** For **Kind**, server should be `https://127.0.0.1:<host_port>` where `<host_port>` matches `docker port` (e.g. `57122`). For **Colima**, `https://127.0.0.1:6443`. If it’s a VM IP (e.g. `192.168.x.x:6443`) or an old port, preflight tries to fix it but may hit the cap before verify succeeds.

### 8.4 KUBECONFIG in use

```bash
echo "KUBECONFIG=${KUBECONFIG:-<unset, using default>}"
ls -la ~/.kube/config 2>/dev/null || true
```

**What to look for:** Scripts use default `~/.kube/config` when `KUBECONFIG` is unset. If you use a different file (e.g. `/tmp/kind-h3.yaml`), set `KUBECONFIG` **before** running the script or it will check the wrong config.

### 8.5 Reachability (same as preflight verify)

```bash
kubectl get nodes --request-timeout=5s
echo "kubectl exit=$?"
```

If that fails:

```bash
docker exec h3-control-plane kubectl get nodes --request-timeout=5s
echo "docker exec exit=$?"
```

(Colima only) If both fail:

```bash
colima ssh -- kubectl get nodes --request-timeout=5s
echo "colima ssh exit=$?"
```

**What to look for:** Preflight verify runs exactly these (kubectl → docker exec → colima ssh). If **all** fail in your terminal, preflight will always report "Cluster not reachable" (or timeout). If they **succeed** here but preflight still times out, the cap is likely too tight (see **8.6**).

### 8.6 Preflight timing (why "timed out" used to happen — **fixed**)

Preflight runs:

1. Colima fix (fast).
2. **Kind port fix:** `docker port` etc. in a subshell with a **10s** kill.
3. **Verify:** `kubectl get nodes` (5s timeout) or docker-exec/colima fallbacks, in a subshell with a **15s** kill.

The **entire** preflight is killed after `PREFLIGHT_CAP` seconds. **Previously**, `PREFLIGHT_CAP` was 12 or 10 in several callers. Kind + verify need **≥ 25s** (10+15) sequentially, so the process was always killed before verify could complete → **"timed out"** every time. **Fix applied:** default is now **30** everywhere (preflight, ensure, runner, check-all-pods-and-tls, baseline, enhanced).

**What to look for:** If you still see "timed out", ensure no caller overrides `PREFLIGHT_CAP` to &lt; 25. You can raise it further (e.g. `PREFLIGHT_CAP=45`) for very slow Docker/API setups.

### 8.7 Ensure timing (run-preflight-scale)

Ensure step uses:

- **`PREFLIGHT_CAP=30`** for the preflight it runs internally.
- **`ENSURE_CAP=30`** for the API-server wait loop.
- **`API_SERVER_MAX_ATTEMPTS=5`**, **`API_SERVER_SLEEP=2`** when invoked from runner/baseline/enhanced (defaults in ensure are 3 / 1).

Preflight now has enough time to complete; the wait loop then retries with more attempts and longer sleep.

### 8.8 One-shot preflight (same as scripts use)

```bash
cd /path/to/record-platform
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
PREFLIGHT_CAP="${PREFLIGHT_CAP:-30}" ./scripts/preflight-fix-kubeconfig.sh
echo "exit=$?"
```

**What to look for:** Scripts now use **30** by default. If this succeeds but the full pipeline still fails, the issue is likely **after** preflight (e.g. ensure wait, trim, or scale). For very slow environments, try `PREFLIGHT_CAP=45`.

### 8.9 Summary of diagnostics

| Check | Pass | Fail → likely cause |
|-------|------|----------------------|
| 8.1 docker/kubectl/colima | All needed tools in PATH | Wrong or incomplete PATH when script runs |
| 8.2 Kind container + port | `h3-control-plane` up, port known | Kind down or wrong cluster |
| 8.3 Context + server | Matches Kind port or Colima 127.0.0.1:6443 | Stale or wrong kubeconfig |
| 8.4 KUBECONFIG | Pointing at config you expect | Script using wrong config |
| 8.5 kubectl / docker exec / colima ssh | At least one reachable | Cluster down or wrong server/port |
| 8.6–8.7 Timing | Caps sufficient (defaults 30) | Override PREFLIGHT_CAP/ENSURE_CAP to &lt; 25, or very slow env |
| 8.8 One-shot preflight | Preflight OK | If pipeline still fails, issue is after preflight |

Run these **before** or **instead of** the failing pipeline. No restarts, no apply, no scale — read‑only. Use the results to decide whether the problem is tooling, kubeconfig, reachability, or timing.

---

## 9. Related Files and Docs

| Resource | Purpose |
|----------|---------|
| `scripts/preflight-fix-kubeconfig.sh` | Fixes Kind port + Colima server, verifies "Cluster reachable"; capped at `PREFLIGHT_CAP` (default 30) |
| `scripts/trim-completed-pods.sh` | Deletes Failed/Succeeded pods when reachable; reduces API load (TRIM_CAP default 15s) |
| `scripts/ensure-api-server-ready.sh` | Retries "API server ready" (uses kctl or kubectl); preflight + wait capped (defaults 30) |
| `scripts/shims/kubectl` | Kubectl shim (timeouts, Kind port, fallbacks) |
| `scripts/lib/ensure-kubectl-shim.sh` | Adds shims to PATH and checks "shim active" |
| `scripts/lib/kubectl-helper.sh` | kctl helper used by ensure-api-server-ready |
| `GUARANTEED-KUBECTL-FIX.md` | Shim, timeouts, Colima 127.0.0.1:6443 |
| `Runbook.md` | Kind h3 TLS/timeouts, port mapping, mass operations |
| `COLIMA-K8S-FIX.md` | Colima Kubernetes reset and basic checks |

---

## 10. Summary

- **"Cluster reachable"** vs **"API server not ready"**: Different scripts and code paths; the second can fail due to PATH, timeouts, or flakiness even when the first succeeds.
- **"kubectl shim not active"**: Shim is not first in `PATH`; fix by exporting `PATH` with `scripts/shims` at the front before running any suite.
- **"Cluster not reachable or preflight timed out"**: Scripts now use **`PREFLIGHT_CAP=30`** and **`ENSURE_CAP=30`** by default (fix for the previous 12/10s caps that killed preflight before verify). If you still see timeouts, run **§8** diagnostics; for very slow envs, raise `PREFLIGHT_CAP` (e.g. 45).
- **Fix without code changes**: Correct `KUBECONFIG`, put **shims first** in `PATH`, ensure Kind/Colima and Docker are healthy, avoid overriding `PREFLIGHT_CAP` or `ENSURE_CAP` to &lt; 25, and use the **One-Command Quick Fix** when possible.

Following this guide should resolve "API server not ready" and "kubectl shim not active" in normal setups; for "preflight timed out" or Colima-specific issues, use **§8** and the related Colima and Runbook docs above.
