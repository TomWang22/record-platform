# RCA: HTTP/3 curl exit 28 (timeout) — Docker bridge vs LB IP path

## Summary

**Symptom:** HTTP/3 tests fail with `curl: (28) ...` (timeout) or `sendmsg() returned -1 (errno 5); disable GSO`.

**Root cause:** Two distinct L3/L4 paths; failure mode depends on which path is used.

---

## Path 1: Host → LB IP (UDP 443)

**Stack:** Host curl → L4 UDP to `127.0.0.1:443` (socat forwards to NodePort) → Caddy QUIC.

- **Root cause of exit 28 / errno 5:** On macOS, ngtcp2 (used by curl for QUIC) can enable **GSO (Generic Segmentation Offload)**. When the NIC or kernel doesn’t support it, `sendmsg()` returns **EIO (errno 5)**. Curl may report this as timeout (28) or as “disable GSO”.
- **Fix:** Set **`NGTCP2_ENABLE_GSO=0`** (scripts do this). Use **native curl with HTTP/3** (e.g. Homebrew `curl` with ngtcp2) so the host talks directly to LB IP:443; avoid the Docker bridge path when possible.
- **Why LB IP and not NodePort for HTTP/3?** MetalLB assigns a real LB IP; socat on the host forwards TCP/UDP 443 to NodePort. Using LB IP:443 from the host exercises the same path as production (LB → Caddy). NodePort works too but is a different path.

---

## Path 2: Docker bridge (host.docker.internal:18443)

**Stack:** Curl runs **inside a container** (e.g. `alpine/curl-http3`) with `--network host` (on Docker Desktop, “host” = VM). Curl → L4 UDP to `host.docker.internal:18443` (socat on Mac listening on 0.0.0.0:18443) → NodePort.

- **Root cause of exit 28:** Usually **timeout**: QUIC handshake or response takes longer than curl’s `--max-time`. VM→host UDP can be slower or drop packets; 18443 must be reachable from the VM.
- **Fix:** (1) Prefer **native curl on the host** with HTTP/3 and `NGTCP2_ENABLE_GSO=0` so this path isn’t used. (2) If Docker bridge is required, increase `--connect-timeout` / `--max-time` for HTTP/3 and ensure socat UDP is running (`setup-lb-ip-host-access.sh` starts it; no `fork` on UDP so QUIC works).

---

## Root fix (enforcement)

1. **Prefer native curl for HTTP/3**  
   Scripts already use `CURL_BIN` (Homebrew curl when available) and set `NGTCP2_ENABLE_GSO=0`. If `curl --help` shows `--http3`, the **LB IP path** is used from the host and GSO is disabled → no errno 5; timeouts are then network/socat only.

2. **When native curl lacks HTTP/3**  
   Scripts fall back to **Docker bridge** (container curl → host.docker.internal:18443). Exit 28 here is a timeout; ensure:
   - `setup-lb-ip-host-access.sh` has been run (socat UDP 443 and Docker bridge 18443).
   - Optional: increase HTTP/3 timeouts in the test script for this path.

3. **Recommendation**  
   Install curl with HTTP/3 support so the host path is used and the Docker bridge is unnecessary:
   ```bash
   brew install curl  # ensure ngtcp2/HTTP/3; then re-run suites
   ```

---

## Telemetry / debugging

- **Which path am I on?** Baseline prints either “HTTP/3 will use native curl via LB IP …” (path 1) or “HTTP/3 will use Docker bridge …” (path 2).
- **Exit 28 on path 1:** Check socat UDP is running; try `NGTCP2_ENABLE_GSO=0` explicitly; verify `curl --http3` works to LB IP from host.
- **Exit 28 on path 2:** Check 18443 is listening on host; from a container, `curl -k --http3 --connect-timeout 15 --max-time 20` to `https://host.docker.internal:18443/_caddy/healthz`.

---

## k3d + MetalLB on macOS

On k3d, HTTP/3 to the MetalLB LB IP goes: host → LB_IP:443 (UDP) → socat → 127.0.0.1:30443 (UDP) → k3d → Caddy. On macOS, **UDP from host to 127.0.0.1:30443** often does not reach the k3d node (Docker networking). So HTTP/3 via LB IP can fail even when socat is up. Run **`./scripts/k3d-status-and-http3-debug.sh`** for 2-node status, registry, MetalLB, socat, and HTTP/3 probes. In-cluster HTTP/3 works: `./scripts/verify-caddy-http3-in-cluster.sh`.

## References

- Runbook items 58 (HTTP/3 Docker bridge), 61 (HTTP/3 GSO), and “HTTP/3 path (L3/L4) and curl exit 28”.
- `scripts/setup-lb-ip-host-access.sh` — socat UDP without `fork` for QUIC.
- `scripts/lib/http3.sh` — `NGTCP2_ENABLE_GSO=0` in container and for native curl.
- `scripts/k3d-status-and-http3-debug.sh` — 2-node status, registry, MetalLB, socat, HTTP/3 checklist (k3d + macOS).
