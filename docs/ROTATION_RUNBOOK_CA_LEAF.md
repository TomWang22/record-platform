# Production Rotation Runbook: CA + Leaf Architecture

You control: **Root CA**, **leaf issuance**, **rotation timing**, **SANs**, **mTLS chain**, and **QUIC TLS handshake behavior**. This runbook engineers all five areas for a CA → leaf setup.

---

## CA + Leaf Implication

- **CA does NOT change** on rotation; only the leaf changes.
- Trust chain is stable → handshake failures are **session reuse failures**, not trust failures.
- Keep CA constant long-term; rotate only the leaf.

---

## 1. Rotation-Safe QUIC Reload (True Graceful)

### The problem

During rotation:

1. Leaf cert changes.
2. Caddy reloads config.
3. Existing QUIC sessions still use the old TLS context.
4. Client (e.g. k6) reuses the connection.
5. Server drops silently (no connection close frame).
6. Client waits ~15s → idle timeout.

TCP/HTTP/2 survives because TCP resets properly; QUIC is silent.

### Caddy config hardening (implemented)

In the **global options block** of `Caddyfile`:

```caddyfile
{
  grace_period 15s
  shutdown_delay 10s
}
```

This allows QUIC (and TLS) sessions to close gracefully during process shutdown or rollout.

### Dual-leaf overlap strategy (ideal)

**Concept:** Keep the old leaf valid, load the new leaf, allow an overlap window (30–60s), drain old connections, then remove the old leaf. QUIC can accept either cert during overlap.

**Caddyfile limitation:** A single server block cannot specify multiple `tls` directives (only the last takes effect). So you cannot do “dual certs in one block” in Caddyfile.

**Ways to get dual-leaf behavior:**

1. **Blue/green Caddy** (recommended): Two deployments (caddy-a, caddy-b). One gets the new cert; switch the Service selector; drain the other. No in-place reload. See §3.
2. **JSON config:** Caddy’s JSON API can load multiple certs; use the admin API if you need true dual-cert in one process.
3. **Current approach:** Pre-rotation Caddy restart (drain QUIC) → update secret → rollout Caddy. No overlap, but simple and already implemented in `scripts/rotation-suite.sh`.

---

## 2. Move Load Generator In-Cluster (Eliminate Host Variable)

**Current path:** Mac → Colima VM → MetalLB → Caddy. The VM boundary is noisy for UDP.

**Target:** K8s Pod → Caddy via **ClusterIP**. No NAT, no Mac UDP stack, no host virtualization in the path.

### In-cluster k6 (existing support)

- **Script:** `scripts/run-k6-chaos.sh start` creates a Job in `k6-load` that runs `k6-chaos-test.js`.
- **When `K6_LB_IP` / `TARGET_IP` are unset**, the script uses **ClusterIP**: `https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz` for both HTTP/2 and HTTP/3. So **in-cluster k6 already targets Caddy via ClusterIP** when not in “MetalLB host” mode.
- **Rotation suite:** Preflight often sets `TARGET_IP` (MetalLB) so host-based checks work. For a **transport-isolation** run (no host/VM in path), run the chaos job without exposing LB IP to the job (e.g. don’t set `K6_LB_IP` in the Job env). The existing Job in `run-k6-chaos.sh` does not set `K6_LB_IP` by default when started from inside the cluster context; it’s set by the rotation suite for host k6.
- **CA:** Mount dev-root via ConfigMap `k6-ca-cert` (rotation suite creates it). Job uses `SSL_CERT_FILE=/etc/ssl/certs/ca.crt` and strict TLS with SNI `record.local` (Host header).

**Interpretation:** If HTTP/3 scales and passes inside the cluster but fails from the host, the host/VM path is the limiter.

### Minimal in-cluster k6 (standalone)

For a one-off in-cluster HTTP/3 test without the full chaos suite:

1. Create namespace and CA ConfigMap (from `certs/dev-root.pem`).
2. Create a Job that runs k6 with a small script (e.g. GET `https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz` with Host: record.local, SSL_CERT_FILE, no reuse).
3. Use image `k6-custom:latest` (with xk6-http3) or ensure the image has HTTP/3 support.

**One-command in-cluster run:**

```bash
./scripts/run-k6-in-cluster.sh
```

This ensures the CA ConfigMap exists, starts the chaos Job **without** `TARGET_IP`/`K6_LB_IP` (so the pod uses ClusterIP), waits for completion, and collects logs. Default duration 30s; set `DURATION=90s` for a longer run.

See `scripts/run-k6-chaos.sh` (Job YAML and env) and `scripts/k6-chaos-test.js` (H2_URL / H3_URL when `K6_LB_IP` is unset) as the reference implementation.

---

## 3. Blue/Green Cert Reload (Production-Grade Rotation)

Avoid in-place Caddy reload; avoid QUIC session invalidation and races.

### Pattern

- Two deployments: e.g. **caddy-a**, **caddy-b** (same app label for Service, or use two labels and switch).
- One Service (e.g. `caddy-h3`) with a **selector** that points to one of the two deployments.
- MetalLB (or NodePort) exposes the Service as usual.

### Rotation steps

1. Issue new leaf (e.g. with your CA).
2. Create/update Secret with **new** leaf (e.g. `record-local-tls-new` or a new name).
3. **Patch deployment B** (the “standby” one) to use the new secret and trigger rollout.
4. Wait for B to be **Ready** (readiness probe, endpoints).
5. **Switch Service selector** from A to B (e.g. `selector: app: caddy-h3, version: b`).
6. Wait for connections to drain from A (grace_period + shutdown_delay help if you scale A to 0).
7. Optionally scale A to 0 or delete; next rotation you’ll patch A with the next leaf and flip back.

### YAML sketch

- Deployments: `caddy-a`, `caddy-b` (e.g. `labels: app: caddy-h3, version: a` and `version: b`).
- Service: `selector: app: caddy-h3, version: a` (or `b`). Switch `version` to the deployment that has the new cert.
- Secrets: each deployment mounts its own secret (e.g. `record-local-tls-a` / `record-local-tls-b`); rotation updates the standby secret, then you flip the selector.

This gives zero-downtime, no in-place reload, and no QUIC session invalidation on the active path.

---

## 4. QUIC Retry and 0-RTT (Advanced)

- **0-RTT:** Session resumption can cause weirdness during cert change. If your Caddy build includes the **experimental_http3** module, you can disable 0-RTT via JSON config (e.g. `allow_0rtt: false`). Standard Caddy builds may not expose this in the Caddyfile.
- **Idle timeout:** During rotation, a temporarily higher idle timeout (e.g. 30s) can reduce “no recent network activity” while connections drain. Our Caddyfile uses `idle 2m` in `servers.timeouts` for normal operation; no need to lower it for rotation if drain + no-reuse are in place.
- **Session tickets:** Avoid reusing session tickets across the cert change; disabling QUIC connection reuse in the client during rotation (e.g. `K6_HTTP3_NO_REUSE=1`) addresses this on the client side.

---

## 5. Deep Dive: What’s Actually Happening

**Symptom:** `timeout: no recent network activity` at ~15s.

The client is waiting for:

- PTO (probe timeout)
- Retransmission attempts
- Idle timeout expiration

**Likely sequence:**

1. Leaf changes (secret update + Caddy reload or new pod).
2. Server TLS context resets; existing QUIC connection IDs become invalid.
3. Client keeps sending encrypted packets on the old connection.
4. Server drops them; no CONNECTION_CLOSE frame is sent.
5. Client waits until the full idle timeout.

So the fix is **never reuse QUIC across rotation** (client-side) and **drain server-side QUIC before or during rotation** (restart Caddy before secret swap, or blue/green). Our current runbook does: pre-rotation Caddy restart, readiness gate on endpoints, and `K6_HTTP3_NO_REUSE=1` in rotation k6.

---

## Optimal Order (What to Do)

1. **Graceful reload config** — Done: `grace_period 15s`, `shutdown_delay 10s` in Caddyfile.
2. **Disable QUIC reuse in rotation k6** — Done: default `K6_HTTP3_NO_REUSE=1` in rotation suite and chaos Job.
3. **Move k6 in-cluster for transport isolation** — Use existing chaos Job without LB IP so it uses ClusterIP; interpret “HTTP/3 works in-cluster but not from host” as host/VM limiter.
4. **Implement blue/green Caddy** — When you want zero in-place reload: two deployments, switch Service selector after new leaf is ready.
5. **Keep CA constant** — Rotate only the leaf; CA changes only for key compromise or long-term rotation policy.

Result: predictable rotation, stable HTTP/3, no host/VM in the critical path when testing in-cluster, and a path to enterprise-style rotation.

---

## Big Picture

Your platform has:

- 8 external Postgres DBs, mTLS gRPC, HTTP/2 + HTTP/3, MetalLB L2, Caddy QUIC, secret rotation, load testing, packet capture, transport study.

The only red signal in this space is **QUIC during rotation under host load**. That puts you in **advanced transport tuning**, not broken infra. This runbook closes the gap between “clever dev hack” and “production CA + leaf rotation.”

---

## References

- `Caddyfile` — global `grace_period` / `shutdown_delay`; `servers.timeouts.idle`.
- `scripts/rotation-suite.sh` — pre-rotation Caddy restart, readiness gate (`_wait_caddy_endpoints`), `K6_HTTP3_NO_REUSE=1`.
- `scripts/run-k6-chaos.sh` — in-cluster Job; ClusterIP when `K6_LB_IP` unset.
- `scripts/k6-chaos-test.js` — H2_URL / H3_URL, noReuse, ClusterIP default.
- `docs/CROSS_DB_CONNECTIVITY_AND_ROTATION_HARDENING.md` — cross-DB and rotation hardening summary.
- `docs/ZERO_DROP_QUIC_ROTATION.md` — exact timings and procedures for single-deploy drain and blue/green (zero-drop QUIC).
- `infra/k8s/caddy-bluegreen/` — blue/green Caddy deployments and Service selector switch.
