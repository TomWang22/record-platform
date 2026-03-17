# Traffic Planes and Test Harness

This doc explains how HTTP/gRPC traffic is routed so enhanced and adversarial tests behave correctly.

## One Ingress Plane (MetalLB)

When `USE_LB_FOR_TESTS=1` and `REACHABLE_LB_IP` is set (after MetalLB verification), **all HTTP and HTTP/3 tests** use:

- **URL:** `https://record.local:443` (or `https://record.local` with implicit 443)
- **Resolve:** `record.local:443` → LB IP (e.g. `192.168.64.240`)
- **No NodePort** for these tests (NodePort on Colima is often not reachable from host → HTTP 000).

`run-all-test-suites.sh` exports `TARGET_IP=$REACHABLE_LB_IP` and `PORT=443` before running baseline, enhanced, and adversarial. Enhanced and adversarial scripts use `CURL_RESOLVE_IP=$TARGET_IP` and `PORT=443` so every curl uses the LB IP.

## gRPC Plane

- **Caddy does NOT proxy gRPC.** Envoy handles gRPC (container port 10000).
- Tests try, in order: (1) port-forward to Envoy pod, (2) LB IP:443 (usually no gRPC there), (3) NodePort 30000/30001.
- On Colima, NodePort is often not on host; port-forward to Envoy is the primary path. Strict TLS to backends is optional (port-forward limits).

## Packet Capture (Path-Aware)

- **HTTP traffic:** Client → LB IP:443 → Caddy. Capture on **Caddy** pods only.
- **gRPC traffic:** Client → Envoy (port-forward or NodePort). Capture on **Envoy** pod.
- **Envoy capture empty** when tests use LB IP is **expected** (HTTP does not go through Envoy). The harness treats empty Envoy capture as info, not failure, when `TARGET_IP` is set.

## Bounded Telemetry

The preflight telemetry loop is no longer unbounded. It runs for at most `TELEMETRY_MAX_DURATION` seconds (default 7200). This avoids runaway processes and SIGKILL under load.

## Malformed Requests (App Layer)

Adversarial tests that send invalid method, oversized header, or garbage body may get 200 from Caddy (it often forwards to backend). Strict handling (405, 431, 400) is an **application** concern (api-gateway or services). The tests accept 200/400/405/431/414 where appropriate and report pass/fail; improving middleware to reject bad requests is a separate change.
