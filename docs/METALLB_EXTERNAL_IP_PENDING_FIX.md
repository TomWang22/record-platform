# MetalLB EXTERNAL-IP Pending — Fix Guide

When `kubectl -n ingress-nginx get svc caddy-h3` shows **EXTERNAL-IP &lt;pending&gt;**:

- `jsonpath='{.status.loadBalancer.ingress[0].ip}'` returns **nothing**
- Scripts that use dynamic LB resolution get no IP
- All traffic to LB (HTTP/2, HTTP/3, gRPC) fails — **not a TLS/CA issue**

---

## Root Cause

**"ClearAssignment ... current IP not allowed by config"** means:

MetalLB's IPAddressPool does not allow the previously assigned IP (or the IP it tried to assign). MetalLB cleared it and did not assign a replacement.

Typical causes:

1. **Pool config changed** — e.g. pool was `192.168.5.240-250`, service had `192.168.64.240`
2. **VM network mismatch** — Colima has `col0=192.168.64.x` but pool is `192.168.5.x`
3. **Pool was reapplied with different range** — old IP no longer valid

---

## Confirm

```bash
kubectl -n ingress-nginx get svc caddy-h3 -o wide
```

If **EXTERNAL-IP** is `<pending>` → confirmed.

```bash
./scripts/diag-metallb-lb-pending.sh
```

---

## Fix Steps

### 1. Inspect current pool

```bash
kubectl get ipaddresspools -A
kubectl describe ipaddresspool -n metallb-system record-platform-pool
```

Check the `addresses` range.

### 2. Find VM network

```bash
colima ssh -- ip addr
```

Use the subnet of `eth0` or `col0` (e.g. `192.168.64.x` or `192.168.5.x`).

### 3. Re-apply pool with correct range

For Colima with `col0=192.168.64.x`:

```bash
METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/install-metallb-colima.sh
```

For Colima with `eth0=192.168.5.x`:

```bash
METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/install-metallb-colima.sh
```

### 4. Force service reassignment

```bash
kubectl -n ingress-nginx delete svc caddy-h3
CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh
```

### 5. Verify

```bash
kubectl -n ingress-nginx get svc caddy-h3
```

**EXTERNAL-IP** must show an IP (e.g. `192.168.64.240`).

```bash
kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

Must return a non-empty value.

---

## Why Everything Broke

- HTTP/2 fails (no listener on old IP)
- HTTP/3 fails (no QUIC on old IP)
- grpcurl fails (connection refused/timeout)
- k6 fails
- Health checks fail

All resemble TLS/CA errors, but the root cause is **no assigned LoadBalancer IP**.

---

## Until LB IP Is Assigned

Nothing else matters — not CA, rotation, Envoy, or mTLS. Fix MetalLB first.
