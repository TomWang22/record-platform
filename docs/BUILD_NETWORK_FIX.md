# Build network: fix once and for all

Docker builds need outbound access to **registry.npmjs.org** (pnpm install) and **Docker Hub** (base images and `# syntax=docker/dockerfile:1`). If you see socket timeouts or `ErrImagePull` / `ImagePullBackOff`, use this.

**Two phases:** (1) **Image resolution/pull** is done by the **Docker daemon** (Colima/Desktop VM) — `--network host` does not apply here. (2) **RUN** steps (e.g. `pnpm install`) use build network; `BUILD_NETWORK=host` fixes npm timeouts in that phase. If Docker Hub times out in phase 1, pre-pull images or fix daemon proxy.

---

## 1. Diagnose

From repo root:

```bash
./scripts/debug-build-network.sh
```

Optional: run the same checks **inside a container** (simulates build):

```bash
IN_CONTAINER=1 ./scripts/debug-build-network.sh
```

This checks: host proxy env, connectivity to npm and Docker registries, DNS, and (without `IN_CONTAINER`) a quick `docker pull busybox`.

---

## 2. Fixes (in order)

### A. Build with host network (recommended)

Use the host’s network for **RUN** steps (e.g. `pnpm install`). Often fixes timeouts when the Docker bridge is slow or restricted.

```bash
BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh
```

Or for the full flow:

```bash
BUILD_NETWORK=host ./scripts/run-full-flow-k3d.sh
```

`build-and-load-k3d.sh` passes `--network host` to `docker buildx build` when `BUILD_NETWORK=host`.

### B. Docker daemon proxy (Docker Desktop / Colima)

If the host is behind a corporate proxy, configure the **daemon** so pulls and builds use it.

- **Docker Desktop:** Settings → Resources → Proxies (or Docker Engine JSON).
- **Colima:** e.g. `colima start --env HTTP_PROXY=... --env HTTPS_PROXY=...` or set in the VM.
- **Linux (systemd):** `/etc/systemd/system/docker.service.d/http-proxy.conf` and `systemctl daemon-reload && systemctl restart docker`.

Example Engine JSON:

```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.example.com:8080",
      "httpsProxy": "http://proxy.example.com:8080",
      "noProxy": "localhost,127.0.0.1,.local"
    }
  }
}
```

### C. Env proxy for the build process

If only your shell uses a proxy, export before building:

```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
./scripts/build-and-load-k3d.sh
```

BuildKit will use these for `RUN` steps.

### D. npm registry timeout / retries (repo `.npmrc` + optional host network)

A repo-level **`.npmrc`** is copied into all Node service Dockerfiles so `pnpm install` in Docker/Colima has more tolerance for flaky VM→registry.npmjs.org:

- `fetch-retries=5`
- `fetch-timeout=300000` (5 min)
- `fetch-retry-mintimeout=20000`, `fetch-retry-maxtimeout=120000`

If you still see **ERR_SOCKET_TIMEOUT** during `pnpm install`, use **host network** for the build so RUN steps use the host’s network stack (see 2A):

```bash
BUILD_NETWORK=host ./scripts/build-and-push-dev.sh
```

(or `build-and-load-k3d.sh` / `run-full-flow-k3d.sh` if you use those). Alternatively try building with **Docker Desktop** instead of Colima (different VM network path):

```bash
docker context use desktop-linux
BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh
# when done, switch back if you use Colima for k3d: docker context use colima
```

Optional mirror in `.npmrc` (in build context): `registry=https://registry.npmmirror.com` — only if you explicitly want a mirror.

### E. Pre-pull base images (when Docker Hub times out in phase 1)

Pull all base images **once** when your network can reach Docker Hub (e.g. VPN on, or retry until success). Later builds use the cache and don’t hit Docker Hub during build.

```bash
./scripts/prepull-build-images.sh
```

Then run `BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh` (or full flow). Pre-pull covers: `docker/dockerfile:1`, `node:20-alpine`, `node:20-bookworm-slim`, `python:3.11-slim`.

### F. Retry

Transient failures (Docker Hub, npm) often succeed on retry:

```bash
./scripts/build-and-load-k3d.sh   # retry if one service fails
```

Or run the full flow again: `./scripts/run-full-flow-k3d.sh`.

---

## 3. Debug layer by layer (when Docker Hub or npm isn’t working)

**Layer 1 – Host → Docker Hub**

- From the repo: `curl -v --connect-timeout 30 --max-time 45 https://registry-1.docker.io/v2/`  
  You should see a connection (e.g. over IPv6) and `401` or `200`. If it hangs, fix host network/VPN/firewall.
- Run `./scripts/prepull-build-images.sh` so the daemon has base images cached.

**Layer 2 – Docker daemon → Docker Hub**

- `docker pull docker/dockerfile:1` and `docker pull node:20-alpine`.  
  If this fails, the daemon (Colima/Desktop VM) can’t reach Docker Hub — set daemon proxy (2B) or retry when network is good.

**Layer 3 – Build RUN → registry.npmjs.org**

- Our Dockerfiles already use `BUILD_NETWORK=host` (when you set the env) and set long npm fetch timeout + low concurrency for deploy.
- If `pnpm deploy` still times out, the **build** container’s network (Colima VM’s “host”) may be flaky to npm. Try:
  1. Retry the build (transient).
  2. Build with Docker Desktop: `docker context use desktop-linux` then run the build script (3.2).
  3. From the host, confirm npm is reachable: `curl -sSfo /dev/null https://registry.npmjs.org/pnpm` — then Layer 3 is VM-specific.

**Then build and load**

- `BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh` (or full flow). Use `SKIP_BUILD=1` for later runs if images are already built.

---

## 4. One-command “fix and run”

1. Diagnose: `./scripts/debug-build-network.sh`
2. If **Docker Hub** times out (image resolution / base image pull): run **pre-pull** when network is good, then build:
   - `./scripts/prepull-build-images.sh`   # run once, e.g. with VPN or when hub is reachable
   - `BUILD_NETWORK=host ./scripts/run-full-flow-k3d.sh`
3. If **npm** times out during `pnpm install` but host can reach npm → use host network: `BUILD_NETWORK=host ./scripts/run-full-flow-k3d.sh`
4. If host cannot reach registries at all → fix proxy/DNS/VPN (see 2B–2C), then pre-pull and run full flow.

---

## Reference

| Item | Purpose |
|------|--------|
| `scripts/debug-build-network.sh` | Check host (and optional container) reachability to npm + Docker Hub |
| `scripts/prepull-build-images.sh` | Pre-pull base images so builds don’t hit Docker Hub during build |
| `BUILD_NETWORK=host` | Use host network for Docker build RUN steps (npm install) |
| `docs/PLATFORM_DEPENDENCIES.md` | Runtime deps (Postgres, Redis, Kafka); build deps (pnpm, npm registry) |
