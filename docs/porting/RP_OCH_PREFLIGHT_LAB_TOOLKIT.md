# OCH preflight-lab toolkit → Record Platform fit

Reference bundle (OCH upstream, reviewed May 2026):

- `~/och-preflight-lab-toolkit-20260520-161924.tar.gz`
- Extracted under `toolkit-reference/och-preflight-lab-toolkit-20260520-161924/`
- Verify: `bash toolkit-reference/och-preflight-lab-toolkit-20260520-161924/scripts/check-och-preflight-lab-toolkit.sh ~/och-preflight-lab-toolkit-20260520-161924.tar.gz`

## Bundle map (do not mix)

| Tarball | Use |
|---------|-----|
| `och-preflight-lab-toolkit-*` | **This doc** — `make preflight-lab`, coverage phase VI.2, k6 grid, Vitest stack |
| `och-cold-bootstrap-toolkit-*` | `make cold-bootstrap` only (OCH) |
| `record-platform-hybrid-cold-bootstrap-toolkit-*` | RP startup DAG (`make cold-bootstrap`) |

## RP porting table (OCH → RP)

| OCH (toolkit) | Record Platform | Status |
|---------------|-----------------|--------|
| `off-campus-housing.test` | `record-platform.test` | `/etc/hosts` + `certs/record-platform.test.crt` |
| `off-campus-housing-tracker` | `record-platform` | `HOUSING_NS` default in Makefile / scripts |
| Postgres **5441–5448** | **5433–5443** | `docker-compose.yml`, hybrid restore only |
| `make preflight-lab` | `make preflight-lab` | Same recipe: stability → QUIC prove → `pnpm preflight-and-suites` |
| `pnpm run coverage:phase-vi2-verify` | Same script path | Uses `RP_PUBLIC_ORIGIN` / `record-platform.test` readyz |
| `make observe` | `make observe` | RP URLs in banner |
| Kafka alignment suite | `scripts/tests/kafka-alignment-suite.sh` | On by default in lab profile |
| booking/social k6 | Skipped | `SKIP_K6_BOOKING_*=1` in `make preflight-lab` |
| `testd/`, `tests/` | Not copied to RP root | Optional review fixtures; use toolkit tree for diagrams |

## Operator flow (RP)

After `HOSTS_AUTO=1 COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap` (or equivalent cluster up):

```bash
pnpm install --frozen-lockfile && pnpm run build

make preflight-lab
# or: SKIP_MACOS_DEV_CA_TRUST=1 make preflight-lab

pnpm run coverage:phase-vi2-verify
# or: make coverage-phase-vi2-verify

bash scripts/report-preflight-lab-suite-inventory.sh
make test-rp-preflight-lab-parity
```

Optional coverage report plumbing:

```bash
make preflight-lab-coverage
pnpm run preflight:lab-report
```

## Critical: edge + SNI

Preflight and `coverage:phase-vi2-verify` fail with opaque 0% matrix when `/api/readyz` is not **HTTP 200** on `https://record-platform.test`:

1. MetalLB IP for `ingress-nginx/caddy-h3` in `/etc/hosts`
2. Leaf SAN includes `record-platform.test`
3. `curl --cacert certs/dev-root.pem` or macOS trust of `dev-root.pem`
4. Keep `x-suite` headers through Caddy/Envoy (coverage attribution)

## Scripts wired to RP edge defaults

These source `scripts/lib/rp-network-contract.sh` (`RP_PUBLIC_ORIGIN=https://record-platform.test`):

- `scripts/coverage/run-phase-vi2-matrix-verify.sh`
- `scripts/coverage/run-full-matrix-local-report.sh`
- `scripts/load/run-k6-transport-v2.sh`
- `scripts/run-housing-k6-edge-smoke.sh` (via `edge-test-url.sh`)

## Suggested verification order

1. `make test-rp-preflight-lab-parity` (static Makefile/script gates)
2. `make preflight-lab` on a cluster from cold-bootstrap
3. `pnpm run coverage:phase-vi2-verify` — compare `bench_logs/matrix-report-latest/routes-hit.jsonl` suite counts
4. Diff `toolkit-reference/och-preflight-lab-toolkit-20260520-161924/scripts/run-preflight-scale-and-all-suites.sh` vs RP copy for new OCH steps (merge selectively; do not revert RP hostnames)
