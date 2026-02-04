# Pin Kubernetes API Server Port (Once and For All)

## Problem

The Colima Kubernetes API server can become inaccessible (`TLS handshake timeout`, `context deadline exceeded`). The API server port may change or the server may be unresponsive after restarts or heavy load.

## Solutions

### 1. Pin Colima Kubernetes port to 6443

Edit `~/.colima/default/colima.yaml` and set:

```yaml
kubernetes:
  enabled: true   # if using Kubernetes
  port: 6443      # was 0 (random)
```

Or run the automated fix:

```bash
./scripts/fix-once-and-for-all.sh
```

This updates the config. Then **restart Colima**:

```bash
colima stop
colima start --kubernetes
# Wait 45–60s for API server to be ready
```

### 2. Wait for API server before tests

All test scripts now call `scripts/ensure-api-server-ready.sh` before any `kubectl` usage. It retries until the API server responds (default: 30 attempts × 3s).

Override via env:

```bash
API_SERVER_MAX_ATTEMPTS=60 API_SERVER_SLEEP=5 ./scripts/test-microservices-http2-http3.sh
```

### 3. Fix once and for all (full procedure)

```bash
# 1. Pin port + wait for API + apply Envoy fix
./scripts/fix-once-and-for-all.sh

# If it says "Restart Colima, then re-run":
colima stop
colima start --kubernetes
# Wait ~60s, then:
./scripts/fix-once-and-for-all.sh

# 2. (Optional) Run smoke test
RUN_TESTS=1 ./scripts/fix-once-and-for-all.sh
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/ensure-api-server-ready.sh` | Wait for API server with retries |
| `scripts/fix-once-and-for-all.sh` | Pin Colima port, wait for API, apply Envoy ConfigMap, restart Envoy |

## Env vars

- `COLIMA_PIN_PORT=0` – skip Colima port pinning in fix-once-and-for-all
- `API_SERVER_MAX_ATTEMPTS` – max wait attempts (default 30)
- `API_SERVER_SLEEP` – seconds between attempts (default 3)
- `RUN_TESTS=1` – run smoke test after fix-once-and-for-all
