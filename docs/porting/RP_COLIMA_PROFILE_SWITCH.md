# Colima profile switch: RP ↔ Record Platform

## Option A — single profile (default)

Use when only one stack runs at a time.

1. Stop RP: `colima stop`
2. Verify: `kubectl get nodes` fails; no `record-platform` pods
3. Bootstrap RP: `colima start` (or `make dev-onboard` / cold-bootstrap when ready)
4. Update `/etc/hosts`: map `record-platform.test` → new MetalLB IP (remove `record-platform.test` → old IP)
5. `make rp-preflight-network-contract`

To restore RP later: stop Colima, start again, restore RP dumps — do not run RP smoke against RP namespace.

## Option B — separate profiles (recommended if both stacks are needed)

```bash
# RP (legacy)
colima start --profile default --kubernetes ...

# RP (isolated)
colima start --profile record-platform --kubernetes --cpu 12 --memory 16 --disk 256
colima profile record-platform
```

Switch with `colima profile <name>` + `colima start` / `colima stop`. Never share the same MetalLB pool and edge hostname between profiles without explicit isolation.

## RP acceptance before live smoke

- Namespace `record-platform` (not `record-platform`)
- No `reservation-mesh` deployment
- Edge host `record-platform.test` only (SNI + MetalLB)
- `make rp-audit-network-contract` passes
- `make rp-smoke-ingress-sni` passes against **RP** cluster

If smoke hits `record-platform.test` or RP pod names, **stop** — wrong cluster.
