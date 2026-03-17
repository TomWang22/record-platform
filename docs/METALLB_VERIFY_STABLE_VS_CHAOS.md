# MetalLB + Caddy H3: Stable vs Chaos Test Modes

The verify script is split into two modes so we **do not mix correctness tests with stress tests**. QUIC is sensitive; TCP is forgiving. The test logic reflects that.

## Architecture Under Test

```
Mac Host → Colima VM → k3s → MetalLB (L2) → LoadBalancer IP → Caddy (HTTP/3)
```

Three layers tested independently:

1. **MetalLB correctness** — controller, speaker, pool, L2Advertisement, LB IP assigned
2. **LoadBalancer service wiring** — host → LB IP (TCP/UDP), in-cluster → LB IP
3. **QUIC behavior** — HTTP/3 over LB IP; in chaos mode, recovery after churn

## VERIFY_MODE=stable (default)

**Purpose:** Verify Caddy H3 + MetalLB correctness. **CI baseline.**

- **No chaos:** Do not restart speaker, simulate ARP, or modify pool.
- **Steps:** MetalLB components → pool → LB IP → host reachability → HTTP/1.1 → HTTP/2 → HTTP/3 via LB IP.
- **HTTP/3:** Must pass within a **15s retry window** (5 attempts, 3s apart). A single `000` or handshake timeout is not a failure until retries are exhausted.
- **Failure:** Script exits 1 if HTTP/3 does not succeed within 15s.

**Run:**

```bash
./scripts/verify-metallb-and-traffic-policy.sh
# or explicitly:
VERIFY_MODE=stable ./scripts/verify-metallb-and-traffic-policy.sh
```

**Backward compatibility:** `SKIP_METALLB_ADVANCED=1` forces stable mode (no advanced/chaos).

## VERIFY_MODE=chaos

**Purpose:** Test recovery after control-plane stress.

- **Chaos:** Runs `verify-metallb-advanced.sh` (speaker restart, ARP simulation, route flaps, multi-pool, etc.).
- **HTTP/3:** May temporarily fail during/after chaos. **New requirement:** HTTP/3 must **recover within 30 seconds** (10 attempts, 3s apart).
- **Failure:** Script exits 1 only if HTTP/3 **never** recovers within 30s.

**Run:**

```bash
VERIFY_MODE=chaos ./scripts/verify-metallb-and-traffic-policy.sh
```

## Design Principles

1. **Stable path never runs chaos** — no speaker restart, no ARP/pool churn in stable.
2. **HTTP/3 checks always use retry** — a single `000` or `ERR_HANDSHAKE_TIMEOUT` is not a failure until the retry window is exhausted.
3. **Chaos path fails only on missing recovery** — temporary QUIC failure is allowed; failure to recover within 30s is not.

## HAProxy (future)

If HAProxy is added in front of Caddy:

- Test **MetalLB + Caddy** first (no HAProxy) — stable then chaos.
- Then add a **separate** test layer: HAProxy UDP 443 → Caddy, Alt-Svc preserved, HTTP/3 through HAProxy. No chaos in that layer until HAProxy baseline passes.

## See also

- `scripts/verify-metallb-and-traffic-policy.sh` — header comments and `VERIFY_MODE` handling
- `scripts/verify-metallb-advanced.sh` — chaos actions (BGP, route flaps, ARP, multi-subnet)
- `docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md` — QUIC/MetalLB root cause and checklist
