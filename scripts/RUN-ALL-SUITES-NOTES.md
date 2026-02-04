# run-all-test-suites.sh – Run Notes and Fixes

## Run: preflight + baseline + start of enhanced (timeout)

### What went right
- **Preflight:** Kubeconfig, API server, DB (all 8 ports), cache verification OK.
- **Messages count:** Social tables now show **142161 messages** (fix: `messages.messages` not `forum.messages`).
- **Baseline:** Tests 1–14 and 16 passed; Envoy Test 4c passed (strict TLS); baseline suite **PASSED** overall.
- **Test 15:** Suite no longer exits at 15a; all gRPC tests run and report (set +e).

### What went wrong (to fix)

1. **Test 15 – port-forward never ready**
   - Every gRPC test (15a–15j): "ERROR: Port-forward failed to establish connection to &lt;local_port>:&lt;grpc_port&gt;".
   - **Cause:** Port readiness uses `nc -z` or `bash -c "echo > /dev/tcp/..."`. On macOS, `/dev/tcp` is not available; if `nc` is missing or not in PATH, the check never passes.
   - **Fix:** Add fallbacks for port readiness: `lsof -i :$port`, and/or short `grpcurl -plaintext -max-time 2` probe so we don’t depend only on nc/dev/tcp.

2. **Test 15 – Envoy path sometimes "gRPC routing issue"**
   - Records (15c, 15d) showed "gRPC routing issue" (Envoy path failed), then port-forward failed too.
   - Once port-forward is reliable, we can re-check Envoy path (method/path and -authority).

3. **User 1 NOT found in auth.users (port 5433)**
   - Post-test DB verification: "User 1 NOT found in auth.users (port 5433)". Auth users live on port 5437 (auth DB); port 5433 is records DB. Message is misleading or the check is wrong.
   - **Fix:** Clarify check: verify user in auth DB (5437); optional cross-check in records if schema expects it.

4. **Account may not be deleted (HTTP 500 instead of 401)**
   - Minor: Delete-account test got 500 once; revocation still verified. Non-blocking.

### Fixes applied (this session)
- **Port-forward readiness:** On macOS, `/dev/tcp` is not available and `nc` may be missing. Added fallbacks in `grpc_test` and `grpc_test_strict_tls`: (1) `lsof -i :$port` to see if anything is listening; (2) `grpcurl -plaintext -max-time 2 127.0.0.1:$port list` – if we get output, port is ready. Port is now considered ready if any of nc, lsof, or grpcurl succeeds.
- **DB verification (5433):** Downgraded "User 1 NOT found in auth.users (port 5433)" to info: "User 1 not in records DB (port 5433) - expected if users live only in auth DB (5437)". Auth DB (5437) is primary; records DB (5433) is optional.
- **gRPC root cause (follow-up):** (1) **Envoy order:** Try **plaintext first** to Envoy (30000/30001), then TLS with -authority – same order as Test 4c so we match the working path. (2) **Port-forward:** Capture stderr to a temp file; in the wait loop check `kill -0 $pf_pid` – if the process died, fail fast and report stderr (e.g. "Unable to listen", "timed out"). (3) Port-forward runs with stderr to `/tmp/pf-$$-port.err` so we can see why it might exit.
- **Auth HTTP/3:** (1) **Test 14b:** Logout via HTTP/3 (runs before Test 14 so token is still valid). (2) **Test 15b:** Delete account via HTTP/3 – register via HTTP/3, delete via HTTP/3, verify login 401 via HTTP/3.

### Root cause: gRPC port-forward and API server reachability
- **Observed:** Port-forward stderr now shows: `Get "https://127.0.0.1:6443/api?timeout=15s": dial tcp 127.0.0.1:6443: connect: connection refused`.
- **Meaning:** When the baseline script runs (as child of run-all-test-suites), it uses `KUBECTL_PORT_FORWARD` (host kubectl). That kubectl talks to the API server at **127.0.0.1:6443**. Connection refused = nothing is listening there **from the host** at that moment.
- **So:** Test 15 gRPC port-forward requires the **host** to reach the Kubernetes API server (e.g. Colima forwarding 6443 to the host). If Colima is running but 6443 isn’t forwarded to the host, or kubeconfig points to a socket that’s only valid inside the VM, port-forward will fail.
- **What to do:** (1) Ensure Colima is running and `kubectl cluster-info` from the host works. (2) If using Colima, ensure your kubeconfig context uses an address the host can reach (e.g. 127.0.0.1:6443 with Colima’s port forward). (3) Preflight already runs “ensure API server ready” (possibly via colima ssh); that doesn’t guarantee the **host** kubectl sees 6443. Consider adding a pre-check: run `kubectl get ns` (with KUBECTL_PORT_FORWARD) before Test 15 and skip or warn if it fails.
