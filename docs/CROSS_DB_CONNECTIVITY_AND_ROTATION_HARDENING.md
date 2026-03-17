# Cross-DB Connectivity and Rotation Hardening

Two separate issue classes:

1. **QUIC rotation instability** — transport-layer lifecycle (stale QUIC after secret reload).
2. **Cross-DB connectivity drift** — application-layer networking (pods → Postgres).

---

## Part 1 — Rotation Hardening (QUIC + Secret Reload)

### What was happening

- HTTP/3 works baseline; fails under rotation with ~15s timeouts.
- Kubernetes updates TLS secret → Caddy reloads → QUIC connections stay alive → connection IDs reference old crypto state → k6 reuses connection → stall → idle timeout.

### Production-grade rotation strategy (implemented)

| Step | What we do |
|------|------------|
| **1. Drain QUIC before secret swap** | Before applying new secrets: `rollout restart deploy/caddy-h3` → `rollout status` → `sleep 10`. All QUIC connections die cleanly; new pods load new cert. |
| **2. Graceful shutdown in Caddy** | Global options: `grace_period 10s` and `shutdown_delay 5s` so QUIC does not die mid-flight during rotation. |
| **3. No HTTP/3 reuse in rotation k6** | `K6_HTTP3_NO_REUSE=1` (default in rotation suite and chaos job). For cert rotation tests, connection reuse = artificial instability. |
| **4. Readiness gate** | After each Caddy rollout we wait until `kubectl -n ingress-nginx get endpoints caddy-h3` has at least one address before continuing load. |

See: `Caddyfile` (global block), `scripts/rotation-suite.sh` (pre-rotation restart, `_wait_caddy_endpoints`), `scripts/run-k6-chaos.sh` (Job env `K6_HTTP3_NO_REUSE`), `scripts/k6-chaos-test.js` (`noReuse` default).

---

## Part 2 — Cross-DB Connectivity Regression

### Symptoms

- **Test 12f — Listings settings 502** on HTTP/2 only; works on HTTP/3.
- **Test 13k — Analytics** “Cannot reach records DB” (POSTGRES_URL_RECORDS, pod → host.docker.internal:5433); HTTP/3 path works.

### Why H3 can work but H2 fails

- HTTP/3 and HTTP/2 can hit different Caddy pods → different backend pods (listings-service / api-gateway / analytics-service).
- Those pods can have different env or DNS resolution (e.g. one resolves `host.docker.internal`, another does not).
- So: **inconsistent environment or DNS across replicas**, or **load balancer routing variance** so the “bad” pod is only on one path.

### What likely broke (Colima)

- Colima updates can change: VM IP, `host.docker.internal` mapping, DNS inside pods.
- If Postgres is bound to `127.0.0.1` instead of `0.0.0.0`, host can reach it but pods cannot.
- Relying on `host.docker.internal` from inside the cluster is fragile.

### Immediate checks (run when 12f / 13k fail)

**From host (cluster must be up):**

```bash
# Listings — can pod reach listings DB (5435)?
kubectl -n record-platform exec -it deploy/listings-service -- sh -c "nc -zv host.docker.internal 5435 2>&1; echo '---'; getent hosts host.docker.internal 2>&1"

# Analytics — can pod reach records DB (5433)?
kubectl -n record-platform exec -it deploy/analytics-service -- sh -c "nc -zv host.docker.internal 5433 2>&1; echo '---'; getent hosts host.docker.internal 2>&1"
```

Or use the script:

```bash
./scripts/check-pod-db-connectivity.sh
```

If `nc` or `getent` is missing in the image, install in the Dockerfile or use a debug sidecar; the script reports “missing nc/getent” when it can’’t run the check.

### Short-term fix (Postgres binding)

Ensure Postgres accepts connections from pods (not only localhost):

- **postgresql.conf:** `listen_addresses = '*'`
- **pg_hba.conf:** `host all all 0.0.0.0/0 md5` (or a narrower range if you prefer)
- Restart Postgres (e.g. Docker Compose or host service).

If Postgres is in Docker, ensure the host or Colima VM IP is correct and that the port (5433, 5435, etc.) is published to `0.0.0.0`, not `127.0.0.1`.

### Mid-term fix (explicit VM IP)

Replace `host.docker.internal` with Colima VM IP for dev:

```bash
colima ip
# e.g. 192.168.64.7
```

Set in env (or ConfigMap/Secret) for services that need DB access:

- `POSTGRES_URL_RECORDS=postgres://user:pass@<colima-vm-ip>:5433/records`
- Listings / analytics / etc. similarly for their DB ports.

Reduces dependence on Docker/Mac hostname resolution inside the VM.

### Long-term fix (production-grade)

- Move Postgres into the cluster: **Pods → ClusterIP Service → Postgres StatefulSet (or operator-managed DB)**.
- Remove `host.docker.internal` from all app config.
- Makes connectivity deterministic and independent of Colima/Docker host networking.

---

## Confirming which pod serves H2 vs H3

If only one path fails (e.g. H2 502, H3 200):

```bash
kubectl -n record-platform get pods -o wide
```

Then send traffic and watch which pod gets requests (e.g. logs or metrics). Often one pod has bad env or no route to DB; the other is fine. Fix env or DB reachability for that pod (or scale to 1 and fix the single replica).

---

## Summary

| Area | Action |
|------|--------|
| **Rotation** | Drain Caddy before secret swap, graceful shutdown, no QUIC reuse in k6, readiness gate on caddy-h3 endpoints. |
| **Cross-DB** | Verify with `check-pod-db-connectivity.sh`; fix Postgres binding and/or use VM IP; target in-cluster Postgres long term. |

You are not debugging chaos — you are moving from “clever dev hack” to a real, deterministic platform.
