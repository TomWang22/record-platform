# Packet Capture: Root Cause and Diagnostics

## Why Packet Capture Can Get Stuck

The packet capture stop phase can appear "stuck" when:

1. **`kubectl exec` hangs** – The API server or the pod may be slow or unresponsive. Every `kubectl exec` (tcpdump install, capture start, first-packet analyze, pcap copy) can block indefinitely if the cluster is under load.

2. **Large pcaps** – Copying large pcap files from pods via `kubectl exec ... cat` can take a long time. With many pods or long captures, the copy phase can exceed expected duration.

3. **tcpdump flush** – After SIGINT, tcpdump needs a few seconds to flush the pcap. If we proceed to copy too quickly, the file may be empty or truncated.

## What CAPTURE_STOP_TIMEOUT Does

When `CAPTURE_STOP_TIMEOUT` is set (default: 30 in preflight/suites):

- **Skip drain** – No wait for in-flight QUIC packets.
- **Kill host PIDs** – SIGINT then SIGKILL to the local `kubectl exec` processes (fast).
- **First-packet analyze** – Still runs with strict timeouts (2s + 5s kubectl + 8s outer cap) so you get TCP/UDP 443 counts.
- **Skip full pcap copy** – No copy to host, no tshark. Avoids long blocks from large pcaps or slow API.

**Tradeoff:** You get first-packet counts (TCP 443, UDP 443) but not full pcap files or tshark verification.

## When You See "Done (timeout set; first-packet analyzed; full pcap copy skipped)"

That message means:

1. The stop phase completed as designed.
2. First-packet analysis ran (TCP/UDP 443 counts); check output above for protocol confirmation.
3. Full pcap copy and tshark were skipped; to get them, run without `CAPTURE_STOP_TIMEOUT`.

## How to Get Full Packet Analysis

1. **Run without timeout** – `CAPTURE_STOP_TIMEOUT= scripts/run-preflight-scale-and-all-suites.sh` (or unset it in your env).
2. **Standalone baseline** – `CAPTURE_STOP_TIMEOUT= CAPTURE_COPY_DIR=/tmp/my-pcaps scripts/test-microservices-http2-http3.sh`.
3. **Increase limits** – `CAPTURE_STOP_TIMEOUT=60 CAPTURE_COPY_TIMEOUT=20 CAPTURE_MAX_STOP_SECONDS=120` for slow clusters.

## HTTP/3 curl exit 28 (Timeout)

When HTTP/3 tests fail with **curl exit 28** (operation timeout):

1. **Root cause** – On macOS, `strict_http3_curl` runs curl inside Docker. The container uses the VM's network, not the Mac's. The Mac's loopback alias (LB IP) and socat are not reachable from the VM.

2. **Root-cause fix** – `setup-lb-ip-host-access.sh` now starts a **Docker bridge** socat: listens on `0.0.0.0:18443` and forwards to NodePort. Containers reach the host via `host.docker.internal:18443`. MetalLB verification writes `DOCKER_HOST_IP` and `DOCKER_FORWARD_PORT` to the env; the baseline uses them for HTTP/3.

3. **Ensure it runs** – Run full preflight (or MetalLB verification) so `setup-lb-ip-host-access.sh` starts the Docker bridge. Or manually: `LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh`

4. **Override** – `HTTP3_FORCE_NODEPORT_ON_DARWIN=1` to always use NodePort (skips Docker bridge).

## Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| `CAPTURE_STOP_TIMEOUT` | 30 (suites) | Bounds stop phase; when set, skips `kubectl exec` (no hang, no analysis). |
| `CAPTURE_MAX_STOP_SECONDS` | 75 | Max wall-clock time for full stop (when timeout not set). |
| `CAPTURE_COPY_TIMEOUT` | 10 | Per-pod timeout for pcap copy. |
| `CAPTURE_DRAIN_SECONDS` | 0 | Seconds to wait before stopping (for QUIC capture). |
| `CAPTURE_COPY_DIR` | (empty) | Host directory to copy pcaps; enables tshark analysis. |
| `KUBECTL_EXEC_TIMEOUT` | 15s | Timeout for each `kubectl exec` call. |
