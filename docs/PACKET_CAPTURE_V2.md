# Packet Capture v2 — 3-Layer Transport Observability (and v3 Transport Summary)

Packet capture v2 captures at three layers so you get **deterministic packet counts** and can see exactly where traffic (or loss) occurs. **Transport observability v3** adds QUIC version extraction, ALPN verification, TLS handshake timing, and automatic baseline-vs-rotation diff with machine-readable JSON.

## Why v2?

Pod-level capture alone can show **no TCP/UDP 443** even when HTTP/2 and HTTP/3 work, because:

- LoadBalancer traffic is **DNAT'd** at the node; the pod may see a different interface or tuple.
- **QUIC (UDP)** can arrive on the host before DNAT; pod tcpdump can miss it.
- Filter or interface choice (`any` vs `eth0`) and **warmup race** can cause empty pcaps.

v2 adds **node-level capture (Layer 1)** as **authoritative**: if the node sees TCP/UDP 443 but the pod does not, the issue is kube-proxy/DNAT/namespace visibility, not the network.

## 3-Layer Model

| Layer | Where | What it proves |
|-------|--------|----------------|
| **L1** | Node (Colima VM) | Real LB ingress traffic (before DNAT) |
| **L2** | Caddy pod | Pod ingress after DNAT (TCP/UDP 443) |
| **L3** | Envoy pod | Upstream hop (gRPC/h2c, TCP 10000) |

Traffic path:

```
macOS (k6/curl) → Colima VM → MetalLB (LB IP) → kube-proxy (DNAT) → Caddy Pod → Envoy Pod → backends
         ↑ L1 capture              ↑ L2 capture              ↑ L3 capture
```

## Usage

Baseline suite uses v2 **by default on Colima** (3-layer capture). To force v2 or disable:

- `USE_PACKET_CAPTURE_V2=1` — use v2 (default on Colima)
- `USE_PACKET_CAPTURE_V2=0` — use legacy pod-only capture

**Transport Hardening V4 (macOS-proof):** On Colima, **node-only capture** is the default (`CAPTURE_NODE_ONLY=1`), so L2/L3 (kubectl exec tcpdump) are skipped and cannot be killed by the host. Ring buffer (`CAPTURE_RING_BUFFER=1`) avoids OOM. Set `STRICT_QUIC_VALIDATION=1` to fail the harness if the node pcap has no QUIC packets or no h3 ALPN. See `docs/TRANSPORT_HARDENING_V4.md`.

Manual use:

```bash
source scripts/lib/packet-capture-v2.sh
init_capture_session_v2
export CAPTURE_V2_CADDY_POD="..."   # optional; auto-discovered if unset
export CAPTURE_V2_ENVOY_POD="..."
export CAPTURE_COPY_DIR="/tmp/my-captures"
start_capture_v2
# ... run tests ...
stop_and_analyze_captures_v2
```

## Layer Details

### Layer 1 (Node)

- **Command:** `colima ssh sudo tcpdump -i any -B 4096 -nn '(tcp or udp) and port 443' -w /tmp/node-capture-v2.pcap`
- **Runs only when** `colima` is available.
- **Buffer:** `-B 4096` to reduce drops.
- **Filter:** Explicit `(tcp or udp) and port 443` (HTTP/2 + HTTP/3).

### Layer 2 (Caddy pod)

- **Skipped when** `CAPTURE_NODE_ONLY=1` (default on Colima; avoids kubectl exec being killed on macOS).
- **Interface:** `eth0` (use `any` only if eth0 is missing in your CNI).
- **Filter:** `(tcp or udp) and port 443`
- **Requires:** tcpdump in the Caddy image (e.g. `ensure-tcpdump-in-capture-pods.sh` or `caddy-with-tcpdump` image).

### Layer 3 (Envoy pod)

- **Skipped when** `CAPTURE_NODE_ONLY=1` (default on Colima).
- **Interface:** `eth0`
- **Filter:** `tcp port 10000` (h2c/gRPC)

## Lifecycle

1. **Start:** L1 → sleep 2s → L2 → sleep 2s → L3 → sleep 2s → **warmup** (default 4s) → **PID check** → then start tests.
2. **Stop:** Drain 5s → SIGINT to all → wait max 5s → force kill → copy pcaps from node/pods → **analyze with `tcpdump -r`** (no grep guessing).
3. **Analysis:** First 5 packets per pcap, then TCP 443 / UDP 443 (and Envoy TCP 10000) counts.

## caddy-h3 Service: TCP and UDP 443

For QUIC (HTTP/3) to work via the LoadBalancer, the **caddy-h3 Service** must expose **both**:

- `port: 443`, `protocol: TCP`
- `port: 443`, `protocol: UDP`

Check:

```bash
kubectl -n ingress-nginx get svc caddy-h3 -o yaml
```

You should see two entries under `spec.ports` (TCP 443 and UDP 443). If UDP 443 is missing, QUIC will only work via NodePort or hostPort, and L1/L2 capture may not see UDP 443.

## Metrics Output

After stop, v2 prints:

- **L1 (node):** TCP 443 count, UDP 443 count (and first 5 packets).
- **L2 (Caddy):** TCP 443 count, UDP 443 count (and first 5 packets).
- **L3 (Envoy):** TCP 10000 count (and first 5 packets).

If L1 has traffic but L2 is empty → kube-proxy/DNAT or pod interface issue; **node-level capture is authoritative**.

## Transport observability v3 (QUIC / ALPN / TLS timing / diff)

When **tshark** is installed and the node pcap exists, after each capture the pipeline:

1. **Extracts** from the node pcap (no grep; tshark structured fields):
   - **QUIC version:** `tshark -Y quic -T fields -e quic.version` → `quic_versions` (e.g. `{"0x00000001": 9211}`)
   - **ALPN TLS (h2):** `tls.handshake.extensions_alpn_str` → `alpn_tls`
   - **ALPN QUIC (h3):** `quic.tls.handshake.extensions_alpn` → `alpn_quic`
   - **TLS handshake timing:** ClientHello → ServerHello per stream → `tls_handshake_ms` (avg, p50, p95, max)

2. **Writes** `transport-summary.json` in the capture dir and (if `CAPTURE_RUN_TYPE` is set) in `TRANSPORT_CAPTURES_DIR/{baseline|rotation}/transport-summary.json`.

3. **Runs diff** when both `captures/baseline/transport-summary.json` and `captures/rotation/transport-summary.json` exist: `scripts/lib/transport-diff.py` outputs JSON and a short human summary (UDP/TCP change %, TLS handshake delta, QUIC version changed).

**Baseline:** Uses `CAPTURE_RUN_TYPE=baseline` and `TRANSPORT_CAPTURES_DIR=/tmp/transport-captures` by default so the baseline run writes the baseline summary. **Rotation:** To get a rotation summary, either run the rotation suite with node-level capture and the same v2/v3 pipeline, or generate from an existing node pcap:

```bash
./scripts/lib/generate-transport-summary-from-pcap.sh /path/to/node.pcap rotation
```

**Deterministic safeguards:** `CAPTURE_WARMUP_SECONDS=4`, `tcpdump -B 4096` on the node, PID verification after start, and node-level capture is authoritative. If the pod capture is empty but the node capture has traffic, the suite logs a warning and does **not** fail (kube-proxy/DNAT masking).

## Files

- **Library:** `scripts/lib/packet-capture-v2.sh` (includes v3 analysis)
- **TLS timing:** `scripts/lib/analyze_tls_timing.py`
- **Baseline vs rotation diff:** `scripts/lib/transport-diff.py`
- **Generate summary from pcap:** `scripts/lib/generate-transport-summary-from-pcap.sh <node.pcap> [run_type]`
- **Baseline integration:** `scripts/test-microservices-http2-http3.sh` (v2 default on Colima)
- **Legacy (pod-only):** `scripts/lib/packet-capture.sh` (when `USE_PACKET_CAPTURE_V2=0`)
