# The Four Layers (Transport Validation)

Clear definitions for debugging and validating HTTP/3 (QUIC) on the platform.

---

## 1. QUIC (Transport Layer)

**What it is**

- UDP-based transport protocol
- Replaces TCP + TLS for the connection
- Handles congestion control, retransmission, encryption

**In this setup**

- Path: **Host → UDP 443 → Caddy**
- If UDP 443 is not bound, QUIC cannot exist

**Check**

- In Caddy pod: `kubectl exec -n ingress-nginx $POD -- ss -lunp | grep 443` (or `netstat -ulnp`)
- You want: `udp ... :::443 ... 1/caddy` → QUIC listener is alive

---

## 2. HTTP/3 (Application Protocol over QUIC)

**What it is**

- HTTP semantics over QUIC
- Requires TLS 1.3
- In Caddy ≥ 2.6: built-in, enabled when TLS + port 443 are active

**In this setup**

- Caddyfile must have `protocols h1 h2 h3` (and TLS on 443)
- Adapted config: `kubectl exec ... -- caddy adapt --config /etc/caddy/Caddyfile | grep -E 'h3|protocols'` should show h3

**Check**

- `protocols include h3 (HTTP/3 enabled in config)` from deploy script, or
- `caddy adapt` output contains `"protocols": ["h1","h2","h3"]` (or similar)

---

## 3. MetalLB / LoadBalancer Exposure

**What it is**

- MetalLB assigns an external IP (e.g. 192.168.64.240) to the LoadBalancer service
- Traffic to that IP is routed to the service (NodePort or direct to pod depending on implementation)

**In this setup**

- Service exposes `443:30443/UDP` (and TCP 443)
- Health gate proves: **Host → LB IP → UDP 443 → Caddy → HTTP/3 → 200 OK**

**Check**

- `kubectl get svc caddy-h3 -n ingress-nginx` shows EXTERNAL-IP and UDP 443
- QUIC probe 200 at `https://192.168.64.240/_caddy/healthz` (e.g. 10×) → path works

---

## 4. Capture Layer

**What it is**

- Where we run `tcpdump` to record QUIC (UDP 443) and validate ALPN (h3).

**Important**

- On Colima, traffic from macOS → VM may **not** traverse a guest interface visible to `tcpdump -i any` (hypervisor/NAT can short-circuit it).
- So: **capture in the Caddy pod** (where the QUIC listener is) or on the **host** (where packets leave), not on the VM.

**In this setup**

- Default: **pod capture** — `kubectl exec` into a caddy-h3 pod, run tcpdump, then `kubectl cp` pcap to host. Deterministic and works on k3s, kind, k3d, Colima.
- Override: `TRANSPORT_CAPTURE_LOCATION=vm` or config `capture.location: vm` for VM capture (Colima SSH); may see 0 bytes if packets don’t hit the VM interface.
- Caddy image must include tcpdump (e.g. `caddy-with-tcpdump`).

**Config**

- Default: `capture.location: pod` (in code; or set in `transport-config.yaml`).
- Force VM capture: `TRANSPORT_CAPTURE_LOCATION=vm` or `capture.location: vm` in config.

**Check**

- `python3 scripts/run_transport_validation.py --capture --v2` uses pod capture by default and writes `vm.pcap` + `transport_validation.json`.

---

## Summary

| Layer              | Status check |
|--------------------|--------------|
| QUIC               | UDP 443 bound in pod (`ss -lunp \| grep 443`) |
| HTTP/3             | Caddy adapt shows h3; Caddyfile `protocols h1 h2 h3` |
| MetalLB / LB       | Service has UDP 443; health probe 200 over QUIC to LB IP |
| Capture            | Use pod (default) or host; avoid VM if Colima hides packets |

---

## Manual curl (HTTP/3)

macOS system curl often does **not** support `--http3`. Use a build with HTTP/3 (e.g. ngtcp2, nghttp3, quiche):

```bash
# Check
curl -V   # look for "HTTP3" in Features

# Install (Homebrew)
brew install curl
# or: brew install curl --HEAD / curl-openssl

# Use Brew curl
export PATH="/opt/homebrew/opt/curl/bin:$PATH"
curl -vk --http3 https://192.168.64.240/_caddy/healthz --resolve record.local:443:192.168.64.240
```

See `scripts/ensure-curl-http3.sh` for a check-and-instruct script.
