# QUIC invariant checklist

Use this to keep HTTP/3 (QUIC) correct for the intended hostname model. Not “make it pass” — **make it correct**.

## Production config

- **Caddyfile:** repo root `Caddyfile` (production). Explicit `https://record.local` block, strict TLS (tls1.2 tls1.3) with `/etc/caddy/certs/tls.crt` and `tls.key`. mTLS is enforced at the gRPC/service layer (Envoy, service-tls, dev-root-ca), not in Caddy.
- **Apply and restore:** `./scripts/ensure-caddy-http3-config.sh` applies the production Caddyfile to the cluster and restarts Caddy. After that, validate QUIC with `./scripts/verify-caddy-http3-in-cluster.sh` (uses record.local and dev-root-ca).

## Production hostname

- **record.local**

Correct behavior:

- Client uses `https://record.local`
- SNI = `record.local`
- Caddy has a server block for `record.local`
- Cert matches `record.local`
- QUIC handshake succeeds

## Do NOT do

- IP-based access for QUIC (`https://10.x.x.x`, `https://<pod_ip>`)
- Arbitrary SNI (e.g. `test.local` unless it matches a Caddy block)
- Open-ended `on_demand` in production (diagnostic only)

## Caddy config (production-safe)

Explicit hostname, no on_demand:

```
record.local {
  tls internal   # or your real cert path
  # ... routes ...
}
```

Minimal QUIC test (playbook):

```
record.local {
  tls internal
  respond "ok" 200
}
```

## How to test QUIC

Always use the same hostname and resolution:

1. **In-cluster (pod or Service)**  
   `curl --http3-only -k --resolve record.local:443:<cluster_ip_or_pod_ip> https://record.local/`

2. **From host (localhost or LB IP)**  
   `curl --http3-only -k --resolve record.local:443:127.0.0.1 https://record.local/`  
   or  
   `curl --http3-only -k --resolve record.local:443:<LB_IP> https://record.local/`  
   (with `--cacert` if not `-k`)

3. **Never**  
   `curl --http3-only -k https://10.42.x.x/`  
   `curl --http3-only -k https://caddy-h3.ingress-nginx.svc.cluster.local/` (no SNI record.local)

## Validation steps (after any Caddy/config change)

1. Apply ConfigMap (if changed).
2. Restart Caddy pod (or rollout).
3. In-cluster:  
   `curl --http3-only -k --resolve record.local:443:<svc_cluster_ip> https://record.local/` → 200
4. Via Service (same as 3 with ClusterIP).
5. Via LB IP or localhost:  
   `--resolve record.local:443:<lb_ip_or_127.0.0.1>` and `https://record.local` → 200

All must use **record.local** as hostname (and SNI).

## When to use on_demand

- **Debug / isolation only**: to prove “QUIC works when SNI/cert is not the problem” (e.g. minimal Caddyfile with `:443 { tls internal { on_demand } }`).
- Do **not** leave on_demand enabled in production or in the main playbook config; it masks SNI mismatch and weakens the invariant.

## Restore production and make QUIC work again

See **docs/QUIC_INVARIANTS.md** for target state and the 5-layer checklist. For a full cluster reset:

1. **Hard reset k3d:** `./scripts/restore-k3d-quic-known-good.sh` (delete + recreate cluster with 30443 tcp+udp).
2. Deploy base, then run ensure-caddy-http3-config.sh and check-quic-invariants.sh.

After debugging or config drift (cluster already up):

1. Apply production Caddyfile and restart Caddy:  
   `./scripts/ensure-caddy-http3-config.sh`
2. Wait for rollout (script waits up to 120s).
3. Validate QUIC (in-cluster, record.local + dev-root-ca):  
   `./scripts/verify-caddy-http3-in-cluster.sh`
4. If using MetalLB/LB IP from host: use `--resolve record.local:443:<LB_IP>` and `--cacert certs/dev-root.pem` with `https://record.local`.

Production Caddyfile already has `servers { protocols h1 h2 h3 }` and `https://record.local { tls ... }`; no on_demand. QUIC works when clients use record.local (SNI + URL).

## Checklist (copy for PRs or runbooks)

- [ ] Caddy server block is explicit for **record.local** (or your production hostname).
- [ ] No **on_demand** in production Caddyfile.
- [ ] All QUIC tests use **--resolve record.local:443:<ip>** and **https://record.local**.
- [ ] No IP-based QUIC tests in the main pipeline (or they are clearly marked debug-only).
- [ ] Cert (production: tls.crt/tls.key; dev: dev-root-ca) matches **record.local**.
