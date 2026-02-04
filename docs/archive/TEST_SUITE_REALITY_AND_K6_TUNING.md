# Test Suite Reality and K6 Tuning

## Run to completion (no timeout)

- **Preflight + all suites:**  
  `KILL_STALE_FIRST=1 ./scripts/run-preflight-scale-and-all-suites.sh`  
  Run with **no** artificial timeout so preflight and all 6 suites finish.

- **Live output + saved log (pipe):**  
  `./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log`  
  Or after preflight:  
  `SKIP_PREFLIGHT=1 ./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log`

- **Results:**  
  Per-suite logs and DB/cache verification logs go to `SUITE_LOG_DIR` (default `/tmp/suite-logs-<timestamp>`). Each suite is `tee`’d to `$SUITE_LOG_DIR/<suite>.log`; verification to `$SUITE_LOG_DIR/<suite>-verification.log`.

## What actually failed (reality)

From a full run:

1. **rotation** – **Real failure:** `rotation-suite.sh` line 269: `local wait_failed=0` used outside a function. **Fix:** use `wait_failed=0` (no `local`). Fixed in repo.
2. **tls-mtls** – **Real failure:** gRPC via Envoy NodePort (127.0.0.1:30000) fails with “context deadline exceeded”. Direct port-forward gRPC with TLS works. So: **Envoy NodePort from host is not reachable** (Colima networking / NodePort not bound on host). Accept as known limitation or fix NodePort/Envoy binding.
3. **baseline / enhanced / adversarial** – **Not failures:** They exited 0 (PASSED). The previous error summary grepped logs for “failed” and wrongly listed them. **Fix:** Error summary now only lists suites that actually exited non-zero (`FAILED_SUITES`).
4. **Enhanced script** – **Real bug:** `[[: 0\n0: arithmetic syntax error]` from tshark/wc output with newlines. **Fix:** Sanitize numeric vars (e.g. `tr -cd '0-9' | head -1`) before arithmetic. Fixed in repo.
5. **Social service DB connectivity: FAILED** (comprehensive verification) – Check runs **inside** the social-service pod (`kubectl exec ... psql $POSTGRES_URL_SOCIAL`). If the pod’s `POSTGRES_URL_SOCIAL` points at host or wrong port, it can fail. **Layer:** DB connectivity from pod to externalized Postgres (host/port/env).

## Layers to tune for K6

After test suites are green, K6 will stress:

| Layer        | What to tune |
|-------------|--------------|
| **DB**      | Postgres: connections, pool size, timeouts; per-service DB config; indexes; auth/records/social/listings/shopping/analytics/auction-monitor DBs. |
| **App**     | Service replicas, CPU/memory limits, health checks; gRPC/HTTP timeouts; bcrypt/auth concurrency; connection pools. |
| **Cache**   | Redis (externalized): connections, Lua/singleflight; listings/shopping cache TTL and keys. |
| **Protocol**| Caddy HTTP/2 + HTTP/3; Envoy gRPC; strict TLS; NodePort vs port-forward for tests. |
| **Gateway** | API gateway timeouts and proxy to upstreams (e.g. social 502 = gateway→social or social→DB). |

Use `SUITE_LOG_DIR` and verification logs to confirm DB/cache and protocol behavior before and after tuning.
