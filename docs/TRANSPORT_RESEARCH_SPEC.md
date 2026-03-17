# Transport Research Lab — Architecture Spec

This document formalizes the **3-layer capture + E2E transport validation** design: hardened QUIC gate, stable multi-point capture, and deterministic validation flow. It aligns the harness with the original intent and supports the network lab research direction.

---

## 1. Original Intention (Restated)

The **first E2E test** verifies:

### Layer 1 — TLS / ALPN
- TLS 1.3 only
- ALPN = `h2` (HTTP/2 path)
- ALPN = `h3` (QUIC path)

### Layer 2 — HTTP Framing
- HTTP/2: SETTINGS frame observed, HEADERS frame observed, no silent fallback
- Frame-level confirmation (optionally via TLS key logging + Wireshark/tshark decryption)

### Layer 3 — QUIC Transport
- QUIC Initial packet present
- QUIC version extracted
- UDP 443 confirmed
- No H3→H2 fallback
- Congestion inference (RTT growth, packet gaps, knee detection)

---

## 2. Separation of Concerns

Validation is split into three **non-overlapping** layers:

| Layer | Purpose |
|-------|--------|
| **Handshake stability** | Gate: sustained strict H3 micro-test (no burst curl churn) |
| **Frame / protocol validation** | TLS keylog + tshark decryption → ALPN, SETTINGS, HEADERS |
| **Throughput / ramp** | Ramp with step collection → knee detection, bottleneck classifier, ceiling report |

---

## 3. Hardened QUIC Validation Gate

**Problem:** A gate that uses repeated `curl --http3-only` creates a new UDP flow each time → NAT churn and false instability.

**Design:** Replace burst probe with a **5-second sustained strict H3 micro-test** via k6 (same conditions as ramp).

- **Script:** `scripts/pre-ramp-transport-gate.sh`
- **Command (conceptually):**  
  `H2_RATE=0 STRICT_H3=1 H3_VUS=1 DURATION=5s K6_LB_IP=<lb> .k6-build/bin/k6-http3 run scripts/k6-chaos-test.js`
- **Success condition:**
  - `h3_protocol_mismatch` = 0 (via transport-summary: `error_rate` < 1%)
  - `h3_timeout` = 0 (via transport-summary: `timeout_rate` < 1%)
  - Throughput > 0 (`rps` > 0)

This matches ramp behaviour; no burst churn, no curl vs k6 differences.

---

## 4. 3-Layer Capture Architecture (Cannot Be Killed)

Capture is taken at **three isolated points** so that if packets disappear, the missing layer is known.

### Capture A — Host (macOS)
- **Command:** `sudo tcpdump -i any port 443 -w host_capture.pcap`
- **Purpose:** Confirm UDP leaves the host; detect host firewall drops.

### Capture B — Colima VM
- **Command:** `colima ssh -- sudo tcpdump -i eth0 port 443 -w vm_capture.pcap`
- **Purpose:** Detect NAT/conntrack drops.  
  If packet exists on host but not VM → macOS/NAT issue.  
  If exists on VM but not pod → kube-proxy / MetalLB.

### Capture C — Caddy Pod
- **Option 1 (kubectl exec):** Run tcpdump inside the existing Caddy container (image must include tcpdump, e.g. `caddy-with-tcpdump:dev`).  
  `kubectl exec -n ingress-nginx <caddy-pod> -- tcpdump -i any port 443 -w /tmp/pod_capture.pcap`
- **Option 2 (sidecar):** Add a sidecar container with `NET_ADMIN` and tcpdump so capture survives independently (see Sidecar YAML below).
- **Purpose:** Confirm QUIC Initial reaches Caddy; confirm HTTP/2 frame exchange.

**Orchestrator:** `scripts/run-three-layer-capture.sh` starts A (optional, requires sudo), B and C via `scripts/lib/packet-capture-v2.sh`, prompts for ramp, then stops and collects pcaps to a session dir and prints a 3-layer summary.

---

## 5. Caddy Pod — Sidecar tcpdump (Optional)

For a **stable pod-level capture** that does not depend on the main container having tcpdump, add a sidecar with minimal capabilities:

```yaml
# Optional sidecar for Caddy pod (e.g. in a patch or overlay)
# Add to spec.template.spec.containers alongside the main caddy container.
- name: tcpdump
  image: alpine:3.18
  command:
    - /bin/sh
    - -c
    - |
      apk add --no-cache tcpdump
      tcpdump -i any -nn '(tcp or udp) and port 443' -w /tmp/pod_capture.pcap
  securityContext:
    capabilities:
      add: ["NET_RAW", "NET_ADMIN"]
    allowPrivilegeEscalation: false
    runAsNonRoot: false
  volumeMounts:
    - name: capture
      mountPath: /tmp
  resources:
    requests: { cpu: "10m", memory: "32Mi" }
    limits:   { cpu: "100m", memory: "64Mi" }
# Add to spec.template.spec.volumes:
- name: capture
  emptyDir: {}
```

Then copy the pcap out after the run:  
`kubectl cp ingress-nginx/<pod-name>:/tmp/pod_capture.pcap ./pod_capture.pcap -c tcpdump`

The orchestrator can use `kubectl exec` on the main container when tcpdump is present in the image, or use this sidecar when you need capture that cannot be killed by the main process.

---

## 6. E2E Validation — TLS + HTTP/2 Frames (H2 Path)

For **HTTP/2** path validation (first E2E test):

1. **TLS key logging**  
   In Caddy (e.g. global options): `{ debug }`  
   Set `SSLKEYLOGFILE=/tmp/sslkeys.log` in the client (or in k6 when supported).

2. **Capture TLS traffic** (e.g. from host or VM pcap).

3. **Load keylog in Wireshark/tshark:**  
   Wireshark: Protocol Preferences → TLS → (Pre)-Master-Secret log filename.  
   tshark: `tshark -r capture.pcap -o tls.keylog_file:sslkeys.log -Y "http2"`

4. **Verify:**
   - ALPN: `h2`
   - SETTINGS frame
   - HEADERS frame
   - DATA frame  
   → No silent fallback; frame-level proof.

---

## 7. QUIC Layer Validation (H3 Path)

QUIC cannot be decrypted easily without qlog. Validate instead by:

- **QUIC Initial** packet presence
- **Version** and **ALPN** from pcap

**tshark examples:**
```bash
tshark -r capture.pcap -Y quic
tshark -r capture.pcap -Y quic -T fields -e quic.version
tshark -r capture.pcap -Y quic -T fields -e tls.handshake.extensions_alpn_str
```

Success: QUIC present, version and `h3` ALPN; no TCP fallback for H3 traffic.

---

## 8. Congestion Inference

- **From ramp_steps.json:** latency vs VU, RPS vs VU, knee detection.
- **From QUIC:** RTT growth (ACK spacing), packet number gaps, loss inference.
- **Comparative:** BBR vs CUBIC delta; MetalLB vs NodePort delta (network lab research).

---

## 9. Structured Validation Flow

Single clean flow (no repeated curl churn, no duplicate health gates):

1. **Transport gate** — Run `scripts/pre-ramp-transport-gate.sh` (5s sustained strict H3).
2. **Start capture** — Run `scripts/run-three-layer-capture.sh` (or start Host + VM + Pod captures manually).
3. **H3 ramp** — e.g. `./scripts/run-h3-ramp.sh --collect-steps` or `./scripts/run-transport-validation.sh`.
4. **Stop capture** — Stop all tcpdumps and collect pcaps (or press Enter in the orchestrator).
5. **Extract:**
   - QUIC version, ALPN, UDP presence, absence of TCP fallback (tshark).
   - Optionally: TLS keylog + decryption for H2 frame verification.
6. **Knee detection** — e.g. `scripts/lib/knee_detection.py` on `ramp_steps.json`.
7. **Bottleneck classifier** — e.g. `scripts/lib/bottleneck_classifier.py`.
8. **Ceiling report** — e.g. `scripts/lib/build_ceiling_report.py` → `transport_ceiling_report.json`.

---

## 10. Finalization Paths (Research Mode)

Once the ramp is stable and knee/congestion are characterized, three paths graduate the framework:

### 10.1 Finalize packet validation → `transport_validated=true`

Run a **controlled capture** at the knee point (e.g. 120 VUs, 30s strict H3), then validate the pcap so the ceiling report flips `transport_validated=true`.

- **Script:** `scripts/run-transport-capture.sh`
- **Default:** 120 VUs, 30s, strict H3; starts 3-layer capture, runs k6, stops capture, runs `transport_validator.py` on best pcap (host > vm > pod), writes `transport_validation.json`.
- **Merge with existing report:** Run after a full validation so `OUT_DIR` already contains `ramp_steps.json`, `knee_result.json`, `bottleneck_result.json`. Then run `run-transport-capture.sh` with the same `OUT_DIR`; it refreshes `transport_ceiling_report.json` with `transport_validated` and `alpn`/`quic_version` from the pcap.
- **Manual check:** `tshark -r host_capture.pcap -Y quic -T fields -e quic.version` → expect `0x00000001`; `tshark -r host_capture.pcap -Y "tls.handshake.extensions_alpn_str"` → expect `h3`.

### 10.2 Publishable transport ceiling report

- **Script:** `scripts/lib/format_ceiling_report.py`
- **Usage:** `python3 scripts/lib/format_ceiling_report.py [OUT_DIR] [-m]` → writes `transport_ceiling_report.md` (table + optional methodology).
- **Wired:** `run-transport-validation.sh` runs the formatter with `-m` after building the JSON report.

### 10.3 BBR vs CUBIC knee comparison (same capture framework)

- **Script:** `scripts/run-bbr-cubic-comparison.sh [--capture] [ramp opts...]`
- **Flow:** Apply BBR (if `colima-quic-sysctl.sh` exists), run ramp with `--collect-steps`; optionally run 3-layer capture during ramp and save to `OUT_DIR/bbr_captures/`. Apply CUBIC (`COLIMA_QUIC_SKIP_BBR=1`), run ramp again; optionally capture to `OUT_DIR/cubic_captures/`. Compare max RPS and knee VUs/RPS; write `transport_comparison_input.json` and `bbr_cubic_comparison_report.md`.
- **Alternative:** `run-transport-validation.sh --bbr-vs-cubic` (no capture; same comparison logic).

---

## 11. Deliverables Summary

| Deliverable | Location |
|-------------|----------|
| Deterministic transport gate | `scripts/pre-ramp-transport-gate.sh` |
| 3-layer capture orchestrator | `scripts/run-three-layer-capture.sh` |
| Controlled capture + validate | `scripts/run-transport-capture.sh` |
| Packet capture (VM + Caddy; optional Host) | `scripts/lib/packet-capture-v2.sh` |
| Caddy sidecar tcpdump (optional) | This spec §5 |
| ALPN + frame validation | TLS keylog + tshark/Wireshark (§6, §7) |
| QUIC version / ALPN extraction | tshark on pcaps; `transport_validator.py` → `transport_validation.json` |
| Congestion / knee / bottleneck | `ramp_steps.json`, knee_detection, bottleneck_classifier, build_ceiling_report |
| Publishable ceiling report | `scripts/lib/format_ceiling_report.py` → `transport_ceiling_report.md` |
| BBR vs CUBIC comparison | `scripts/run-bbr-cubic-comparison.sh [--capture]`; `run-transport-validation.sh --bbr-vs-cubic` |

---

## 12. References

- **Pre-ramp health gate (curl probe):** `scripts/pre-ramp-health-gate.sh`
- **Transport validation engine:** `scripts/run-transport-validation.sh`
- **H3 ramp:** `scripts/run-h3-ramp.sh`
- **In-cluster k6:** `scripts/run-k6-in-cluster.sh` (isolate UDP path: host/Colima vs in-cluster)
- **Benchmarking and gate usage:** `docs/TRANSPORT_BENCHMARKING_V5.md`
- **Finalization:** `run-transport-capture.sh` (packet proof), `format_ceiling_report.py` (markdown), `run-bbr-cubic-comparison.sh` (BBR vs CUBIC)
