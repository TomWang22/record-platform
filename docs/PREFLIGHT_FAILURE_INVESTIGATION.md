# Preflight failure investigation

When `run-preflight-scale-and-all-suites.sh` or `run-all-test-suites.sh` reports failed suites (e.g. **baseline**, **rotation**), use this guide to narrow down root cause and next steps.

## Baseline suite failed

### Symptoms

- Exit code non-zero; "Key issues" may show nothing or generic errors.
- Log may end after Test 13j7 or at "DB verification" / "Packet capture — stop".

### Likely causes

1. **Test 13g (Request Return) HTTP 404**  
   - Return request uses `order_id` + `purchase_id` from the same order details response.  
   - If 404 persists: ensure 13c checkout succeeded, `shopping.returns` exists (preflight 6f / `ensure-shopping-order-number-sequence.sh`), and IDs are not swapped.

2. **DB verification subshell exit (e.g. SSH mux)**  
   - After Tests 1–15b, the baseline runs an inline DB verification in a background subshell.  
   - If that subshell hits `mux_client_request_session: session request failed: Session open refused by peer` (Colima SSH multiplexing limit), it exits 1; previously the main script then exited 1 too.  
   - **Fix applied:** Baseline now catches that exit and warns instead of failing the suite. Re-run; if the only failure was DB verify, baseline should pass.

3. **Packet capture stop phase**  
   - Stopping tcpdump uses `kubectl exec` (or Colima shim). Under load, SSH mux can refuse new sessions.  
   - Capture stop runs with `set +e` and a short wait cap; the suite should still finish. If the script exits before "Baseline suite finished", check the last lines of the log for the failing command.

### What to do

- Re-run baseline: `./scripts/test-microservices-http2-http3.sh`.  
- If 13g still 404: inspect order/returns schema and IDs (see shopping service and DB docs).  
- If failure is at DB verify or capture stop: reduce parallel Colima/SSH usage (e.g. run fewer suites in parallel, or use in-cluster k6 for rotation so host doesn’t pile on SSH).

---

## Rotation suite failed

### Symptoms

- `mux_client_request_session: session request failed: Session open refused by peer`
- `http_req_failed: rate=0.00 passes=0 fails=28800`
- `thresholds on metrics 'h3_fail' have been crossed`

### Likely causes

1. **SSH multiplexing ("Session open refused by peer")**  
   - Rotation runs k6 (and possibly `kubectl`/`colima ssh`) from the host. Many concurrent SSH sessions (e.g. port-forwards, execs, or Colima shim) can hit the SSH server’s limit and refuse new sessions.  
   - **Mitigation:** Use in-cluster k6 so rotation doesn’t rely on host→VM SSH for load: `ROTATION_H2_KEYLOG=0` (rotation-suite uses in-cluster k6 job). Or run rotation alone and avoid other heavy Colima/SSH use.

2. **k6 HTTP/3 100% failure (h3_fail)**  
   - All H3 requests fail (e.g. timeouts ~15s). Typical causes:  
     - Stale QUIC sessions after Caddy reload (cert rotation).  
     - Host k6 using connection reuse: set `K6_HTTP3_NO_REUSE=1` (rotation-suite exports this).  
   - **Mitigation:**  
     - Rebuild k6 with xk6-http3 and use `K6_HTTP3_NO_REUSE=1`.  
     - Or run k6 in-cluster (`ROTATION_H2_KEYLOG=0`) so H3 traffic stays inside the cluster and avoids host QUIC/Colima quirks.

### What to do

- Re-run rotation: `./scripts/rotation-suite.sh`.  
- For in-cluster k6: `ROTATION_H2_KEYLOG=0 ./scripts/rotation-suite.sh` (ensure k6 image and CA ConfigMap exist).  
- If "Session open refused" appears in rotation log: run rotation in isolation, or rely on in-cluster k6 to reduce host SSH usage.

---

## Experiment 4 (NodePort check) shows "returned 000"

- Previously, the script could pass **two** node addresses (e.g. IPv4 + IPv6) as a single string to `curl`, producing an invalid URL and HTTP 000.  
- **Fix applied:** Node IP is taken as the first token and must be IPv4 for the curl check; otherwise the check is skipped with an explanatory message.  
- From the host, NodePort is often unreachable (VM-only). Use MetalLB LB IP or port-forward for host tests; NodePort is for VM-internal or manual comparison.

---

## References

- **Rotation H3 / protocol:** `docs/QUIC_SESSION_TUNING_APPLIED.md`, `docs/PREFLIGHT_TROUBLESHOOTING.md`  
- **Transport study:** `docs/TRANSPORT_LAYER_STUDY_PLAN.md`, `scripts/run-transport-study-experiments.sh`  
- **Run optional 7b steps:** `TRANSPORT_STUDY_RUN_EXP4=1 TRANSPORT_STUDY_RUN_EXP6=1 ./scripts/run-transport-study-experiments.sh`
