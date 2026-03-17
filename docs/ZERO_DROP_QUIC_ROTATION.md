# Zero-Drop QUIC Rotation: Timings and Procedures

Mathematical and procedural guide so QUIC rotation does not drop in-flight connections or cause client timeouts.

---

## Why QUIC Drops During Rotation

1. Leaf cert changes → server TLS context resets.
2. Existing QUIC connection IDs become invalid.
3. Client keeps sending on old connection → server drops; no CONNECTION_CLOSE.
4. Client waits idle timeout (~15s) → failure.

**Goal:** Either (a) drain all QUIC before switching cert, or (b) switch traffic to a new pool that already has the new cert (blue/green).

---

## Strategy 1: Single-Deploy Drain (Current)

**Idea:** Restart Caddy **before** updating the secret so all QUIC connections die. Then apply new secret and rollout so new pods load the new cert. No overlap; no client reuse across the boundary.

### Timings

| Step | Action | Duration | Cumulative |
|------|--------|----------|------------|
| 1 | Pre-rotation: `rollout restart deploy/caddy-h3` | — | 0 |
| 2 | Wait `rollout status` | 60–120s | 60–120s |
| 3 | `sleep 10` (drain buffer) | 10s | 70–130s |
| 4 | Readiness gate: endpoints have addresses | 0–30s | 70–160s |
| 5 | Update secrets (leaf + CA if needed) | — | — |
| 6 | Rollout Caddy again (or hot reload) so pods mount new cert | 60–120s | — |
| 7 | Readiness gate: endpoints ready | 0–45s | — |
| 8 | Start load (k6) with **K6_HTTP3_NO_REUSE=1** | — | — |

**Critical:** Client must **not** reuse QUIC connections across the rotation window. So rotation suite and k6 chaos job set `K6_HTTP3_NO_REUSE=1`.

**Caddyfile:** `grace_period 15s` and `shutdown_delay 10s` so existing QUIC sessions get a clean shutdown (up to 25s) before process exit.

### Scripted flow (rotation-suite.sh)

1. Restart Caddy (pre-rotation).
2. Wait rollout + sleep 10.
3. Wait `_wait_caddy_endpoints` (pre-rotation).
4. Update Kubernetes secrets.
5. Trigger Caddy reload or rollout (post-rotation).
6. Wait `_wait_caddy_endpoints` (post-rotation).
7. Run k6 with `K6_HTTP3_NO_REUSE=1`.

---

## Strategy 2: Blue/Green (Zero In-Place Reload)

**Idea:** Two deployments (caddy-a, caddy-b). One is “active” (Service selector). Issue new leaf → load into standby deploy → wait Ready → switch Service selector → traffic moves to new cert with no in-place reload. No QUIC session invalidation on the active path.

### Timings

| Step | Action | Duration | Notes |
|------|--------|----------|--------|
| 1 | Issue new leaf (same SANs, same CA) | — | — |
| 2 | Create/update secret `record-local-tls-b` with new leaf | — | — |
| 3 | Rollout deployment caddy-b | — | B picks up new secret |
| 4 | Wait `rollout status deployment/caddy-b` | 60–120s | B pods Ready |
| 5 | Optional: wait for B endpoints (if B already has a selector) or rely on rollout | 5–10s | — |
| 6 | Patch Service: selector `version: b` | — | Traffic switches to B |
| 7 | Drain A: wait grace_period + shutdown_delay | **25s** | 15s + 10s from Caddyfile |
| 8 | Scale caddy-a to 0 (or leave for next rotation) | — | Next time put new cert in A and switch back |

**Overlap window:** From step 6 onward, both A and B can have traffic only until kube-proxy/endpoints converge; in practice only B receives new connections. Existing connections to A complete or drain within 25s.

### Exact kubectl sequence (blue/green)

```bash
# 1. New leaf in secret for B
kubectl -n ingress-nginx create secret tls record-local-tls-b \
  --cert=new-leaf.crt --key=new-leaf.key \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. Rollout B
kubectl -n ingress-nginx rollout restart deployment/caddy-b
kubectl -n ingress-nginx rollout status deployment/caddy-b --timeout=120s

# 3. Readiness: B has endpoints (after switch, B will be the only backend)
#    Optional pre-switch: scale caddy-a to 2 if not already, ensure caddy-b has 2 Ready pods.

# 4. Switch Service to B
kubectl -n ingress-nginx patch svc caddy-h3 -p '{"spec":{"selector":{"app":"caddy-h3","version":"b"}}}'

# 5. Drain A (wait for QUIC idle timeout to exceed)
sleep 25

# 6. Scale A to 0 (optional)
kubectl -n ingress-nginx scale deployment/caddy-a --replicas=0
```

### Next rotation (A becomes active again)

- Put next new leaf in `record-local-tls` (or `record-local-tls-a` if you use separate secret names).
- Scale caddy-a to 2; patch caddy-a to use the new secret if needed.
- Rollout caddy-a; wait Ready.
- Patch Service selector to `version: a`.
- Sleep 25s; scale caddy-b to 0.

---

## Recommended Values (Summary)

| Parameter | Value | Where |
|-----------|--------|--------|
| grace_period | 15s | Caddyfile global |
| shutdown_delay | 10s | Caddyfile global |
| Drain sleep after pre-rotation restart | 10s | rotation-suite.sh |
| Readiness gate (endpoints) | 30–45s timeout | rotation-suite.sh |
| K6_HTTP3_NO_REUSE | 1 | rotation suite + chaos Job |
| Blue/green drain after selector switch | 25s | Before scale old deploy to 0 |

---

## References

- **docs/ROTATION_RUNBOOK_CA_LEAF.md** — CA + leaf strategy, blue/green, in-cluster k6.
- **infra/k8s/caddy-bluegreen/README.md** — Blue/green apply and rotation steps.
- **scripts/rotation-suite.sh** — Single-deploy drain + readiness gate + K6_HTTP3_NO_REUSE.
