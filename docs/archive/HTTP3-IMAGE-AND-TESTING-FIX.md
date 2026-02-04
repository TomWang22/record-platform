# HTTP/3 Image and Testing Fix

**Status:** ✅ Fixed and aligned with `scripts/lib/http3.sh`

## 1. HTTP/3 Enhanced Image (Fixed)

**Dockerfile:** `docker/http3-curl-enhanced/Dockerfile`

- **Base:** `alpine/curl-http3:latest` (existing image with HTTP/3 curl).
- **No Homebrew, no grpcurl** – avoids 404s and broken fallbacks.
- **Added via apk:** `tcpdump`, `tshark`, `net-tools`, `iproute2`, `bind-tools`, `jq`, `valgrind`.

**Build:**
```bash
./scripts/build-http3-image.sh
# or
docker build -t http3-curl-enhanced:latest -f docker/http3-curl-enhanced/Dockerfile docker/http3-curl-enhanced/
```

**Usage:** `http3.sh` uses `http3-curl-enhanced:latest` when the image exists locally; otherwise it uses `alpine/curl-http3:latest`.

## 2. `scripts/lib/http3.sh` Alignment

- **Image choice:** Prefer `http3-curl-enhanced:latest` if present, else `alpine/curl-http3:latest`.
- **Existing logic kept:** HOST_NETWORK for Colima/k3s, container network for Kind, docker/podman detection.

## 3. Packet Capture (Correct and Shared)

**Lib:** `scripts/lib/packet-capture.sh`

- **`init_capture_session`** – set capture dir, clear state.
- **`start_capture <ns> <pod> [filter]`** – ensure tcpdump in pod, start capture.
- **`stop_and_analyze_captures [1=analyze]`** – stop captures, optionally analyze.
- **`analyze_captures`** – print TCP 443 / UDP 443 / 30443 counts and samples.
- **`verify_protocol_counts [file]`** – optional check that TCP 443 and UDP 443 counts are both > 0.

Used by:
- `scripts/test-with-packet-capture.sh`
- `scripts/enhanced-adversarial-tests.sh` (Test 3)

## 4. Valgrind Memory-Leak Testing

**Script:** `scripts/valgrind-memory-leak-test.sh`

- Runs `valgrind --leak-check=full` on `curl` (HTTP/3) inside the HTTP/3 image.
- **Enabled only when** `RUN_VALGRIND=1`.
- Skips if the image has no valgrind or the image is missing.

**Usage:**
```bash
RUN_VALGRIND=1 ./scripts/valgrind-memory-leak-test.sh
# or
RUN_VALGRIND=1 ./scripts/test-with-packet-capture.sh  # runs valgrind at the end
```

## 5. Test Suite Updates

- **Baseline / enhanced / rotation:** Use kubectl shim; unchanged otherwise.
- **`test-with-packet-capture`:** Uses packet-capture lib, `http3_curl` for HTTP/3 traffic, optional valgrind.
- **`enhanced-adversarial-tests`:** Uses `http3_curl`, shared packet capture, `$PORT`, DB disconnect and cache tests.

## 6. Summary

| Item | Status |
|------|--------|
| HTTP/3 image build (no Homebrew/grpcurl) | ✅ Fixed |
| `http3.sh` uses enhanced image when available | ✅ |
| Packet capture lib (start/stop/analyze/verify) | ✅ |
| Packet capture correct in Colima/k3s | ✅ (HOST_NETWORK + shared lib) |
| Valgrind memory-leak test | ✅ (optional via `RUN_VALGRIND=1`) |
| Comparison step (protocol counts) | ✅ `verify_protocol_counts` |
