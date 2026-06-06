# Record Platform — `make preflight-lab`

Canonical Colima + MetalLB strict lab (OCH `preflight-lab` parity). Requires a cluster already brought up (`make cold-bootstrap` or `make bootstrap`).

## Command

```bash
make preflight-lab
# optional fixed Jaeger UI:
# PREFLIGHT_STRICT_JAEGER_QUERY_BASE=http://127.0.0.1:16686 make preflight-lab
# skip macOS keychain dev-root check:
# SKIP_MACOS_DEV_CA_TRUST=1 make preflight-lab
# require step 7b transport study (L1 capture during in-cluster k6):
# PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 make preflight-lab
```

Alias: `make preflight-strict` (same recipe).

## Ordered gates (terminal + logs)

| Step | What |
|------|------|
| 1 | `ensure-node20` — Node 20.x per `.nvmrc` |
| 2 | `scripts/cluster-stability-guard.sh` |
| 3 | `make transport-quic-v6-v7-prove` — standalone packet capture + `transport-summary-v6/v7.json` jq gates |
| 4 | `pnpm preflight-and-suites` → `scripts/run-preflight-scale-and-all-suites.sh` |

Inside step 4 (high level):

- Phases 1–6: MetalLB, TLS, KRaft Kafka, topic creation, **6a2c9 `scripts/tests/kafka-alignment-suite.sh`** (`KAFKA_ALIGNMENT_TEST_MODE=1` by default)
- Phase 1 (strict): `preflight-controlled-transport-otel-prove.sh` or `make transport-quic-v6-v7-prove` again when `PREFLIGHT_STRICT_EXIT=1`
- Step 7: Vitest stack, k6 edge grid (`run-housing-k6-edge-smoke.sh`), Playwright, optional Phase D / transport study

Lab profile env (set by Makefile + `REQUIRE_COLIMA=1 METALLB_ENABLED=1`):

- `PREFLIGHT_LAB=1` — appends `k6-preflight-lab-randomized-all-endpoints.js` after the k6 grid
- `PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=0` + `KAFKA_ALIGNMENT_TEST_MODE=1`
- `PREFLIGHT_RUN_REPO_VITEST_STACK=1`
- `PREFLIGHT_STEP7_OBSERVABILITY_GATES=1`
- `SKIP_K6_BOOKING_SEARCH=1` / `SKIP_K6_BOOKING_HEALTH=1` (no booking-service in RP)

Main transcript: `bench_logs/preflight-<timestamp>.log` (when Colima+MetalLB lab profile is active).

## Optional coverage matrix (not default)

```bash
make preflight-lab-coverage
```

Route-hit matrix + `bench_logs/preflight-lab-report.md` (same optional plumbing as OCH toolkit report inventory).

## Inventory

```bash
bash scripts/report-preflight-lab-suite-inventory.sh
bash scripts/test-rp-preflight-lab-parity.sh
```

## Coverage phase VI.2 (after cluster + hosts)

```bash
pnpm run coverage:phase-vi2-verify
# or: make coverage-phase-vi2-verify
# or: make observe   # vi2 + analytics QA + sample k6 (best-effort)
```

Ready check uses `https://record-platform.test/api/readyz` (via `scripts/lib/rp-network-contract.sh`).

## Reference

- OCH preflight-lab toolkit: `docs/porting/RP_OCH_PREFLIGHT_LAB_TOOLKIT.md` and `toolkit-reference/och-preflight-lab-toolkit-20260520-161924/`
- OCH cold-bootstrap toolkit: `toolkit-reference/och-cold-bootstrap-toolkit/Makefile`
- Hybrid cold-bootstrap toolkit: `make package-rp-hybrid-toolkit` (cluster bring-up only; run preflight-lab after)
