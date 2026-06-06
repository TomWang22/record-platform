# Colima profile switch: OCH ↔ Record Platform

## Option A — single profile (default)

Use when only one stack runs at a time.

1. Stop OCH: `colima stop`
2. Verify: `kubectl get nodes` fails; no `off-campus-housing-tracker` pods
3. Bootstrap RP: `colima start` (or `make dev-onboard` / cold-bootstrap when ready)
4. Update `/etc/hosts`: map `record-platform.test` → new MetalLB IP (remove `off-campus-housing.test` → old IP)
5. `make rp-preflight-network-contract`

To restore OCH later: stop Colima, start again, restore OCH dumps — do not run RP smoke against OCH namespace.

## Option B — separate profiles (recommended if both stacks are needed)

```bash
# OCH (legacy)
colima start --profile default --kubernetes ...

# RP (isolated)
colima start --profile record-platform --kubernetes --cpu 12 --memory 16 --disk 256
colima profile record-platform
```

Switch with `colima profile <name>` + `colima start` / `colima stop`. Never share the same MetalLB pool and edge hostname between profiles without explicit isolation.

## RP acceptance before live smoke

- Namespace `record-platform` (not `off-campus-housing-tracker`)
- No `booking-service` deployment
- Edge host `record-platform.test` only (SNI + MetalLB)
- `make rp-audit-network-contract` passes
- `make rp-smoke-ingress-sni` passes against **RP** cluster

If smoke hits `off-campus-housing.test` or OCH pod names, **stop** — wrong cluster.
