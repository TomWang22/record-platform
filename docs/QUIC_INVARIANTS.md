# QUIC invariants

Target state and layer checklist. No drama. Deterministic recovery.

## Target state

- k3d 2-node cluster (1 server + 1 agent)
- **UDP 30443** published (docker ps shows 30443/tcp and 30443/udp)
- Caddy: **explicit hostname block** `record.local`, **no on_demand**
- HTTP/2 and HTTP/3 working
- **All QUIC tests use:** `--resolve record.local:443:<ip>` and `https://record.local` (never raw IP URL)

## Layer 1 — Host

- [ ] **lo0 alias** present if using LB_IP (e.g. `ifconfig lo0 | grep 192.168.`)
- [ ] **UDP 30443** published: `docker ps | grep 30443` shows both tcp and udp
- [ ] **curl** supports HTTP/3: `curl --help all | grep -q -- --http3-only` (e.g. Homebrew curl with ngtcp2)

## Layer 2 — NodePort

```bash
curl --http3-only -k --resolve record.local:443:127.0.0.1 https://record.local:30443/_caddy/healthz
```

Must return 200. If not → Docker UDP layer or Caddy not ready.

## Layer 3 — Pod

```bash
kubectl exec -n ingress-nginx deploy/caddy-h3 -- ss -ulnp 2>/dev/null | grep 443
# or: netstat -ulnp | grep 443
```

UDP 443 must be listening. If not → Caddy config or not restarted after config apply.

## Layer 4 — Service

```bash
kubectl get svc caddy-h3 -n ingress-nginx -o yaml | grep -A2 protocol
```

Must contain `protocol: UDP` for port 443 (https-udp).

## Layer 5 — SNI alignment

- All tests use: `--resolve record.local:443:<ip>` and `https://record.local` (or `https://record.local:30443/...` when using NodePort from host).
- **Never:** `https://10.x.x.x`, `https://<pod_ip>`, or arbitrary hostname without matching Caddy block.

## Restore flow

1. **Hard reset:** `./scripts/restore-k3d-quic-known-good.sh` (delete + recreate cluster, verify 30443 tcp+udp).
2. Deploy base: `kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s`.
3. **Restore Caddy (no on_demand):** `./scripts/ensure-caddy-http3-config.sh`.
4. **Guard:** `./scripts/check-quic-invariants.sh`.
5. **Validate QUIC:** `./scripts/verify-caddy-http3-in-cluster.sh`.

## Lock test semantics

- Replace any QUIC test that uses `https://10.x.x.x` or raw pod IP with:
  - `--resolve record.local:443:<ip>` and `https://record.local` (or `https://record.local:<port>/...` with port if not 443).
- See **QUIC Invariant Checklist** below for full checklist and production config.

## Protocol enforcement (no accidental IP QUIC)

- **http3_curl** (scripts/lib/http3.sh): When `HTTP3_ENFORCE_HOSTNAME=1` (default), blocks raw IP URLs and wrong hostname; returns 96/97/98. `HTTP3_AUTO_RESOLVE=1` injects `--resolve record.local:443:<TARGET_IP>`. `HTTP3_ASSERT_ALPN=1` requires "using HTTP/3" in output (use `-v`).
- **CI:** `./scripts/check-no-ip-quic.sh` fails the build if any code uses `curl --http3 ... https://<digit>.*`.
- **Debug only:** Set `HTTP3_ENFORCE_HOSTNAME=0` to allow non–record.local (e.g. localhost) for local debugging.
- **Single source of hostname:** `.env` / `.env.example`: `HTTP3_EXPECTED_HOST=record.local`.

## Optional validators (SAN, ALPN, packet proof)

- **Certificate SAN:** `./scripts/http3-assert-cert-san.sh` (openssl s_client + SAN check).
- **QUIC traffic:** `./scripts/http3-assert-quic-traffic.sh` (tcpdump UDP 443 during curl; needs sudo).
- **All-in-one:** `./scripts/http3-contract-validator.sh` (SAN + ALPN + packet count).
- **NodePort UDP proof:** `./scripts/nodeport-udp-proof.sh` (proves NodePort UDP reachable or not from host).

## Clean bootstrap (443 @ loadbalancer, no NodePort for QUIC)

- **Alternative cluster:** `./scripts/k3d-http3-clean-bootstrap.sh` creates cluster with `443:443` and `443:443/udp` on loadbalancer only (Traefik disabled). Then deploy base, Caddy, and run `./scripts/http3-contract-validator.sh` with `PORT=443`.
- **Preload images:** `./scripts/preload-images.sh` after cluster create to avoid ImagePullBackOff after Docker restart. Caddy deploy uses `imagePullPolicy: IfNotPresent`.

## Run full preflight (MetalLB + suites)

Example (k3d, MetalLB, no pgbench, shopping sequence, Colima L2 verify):

```bash
SUITE_TIMEOUT=0 METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 RUN_SHOPPING_SEQUENCE=1 METALLB_VERIFY_COLIMA_L2=1 ./scripts/run-preflight-scale-and-all-suites.sh
```
