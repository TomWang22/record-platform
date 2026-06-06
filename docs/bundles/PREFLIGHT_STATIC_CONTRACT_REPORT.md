# Preflight static contract report

**Preflight:** `scripts/run-preflight-scale-and-all-suites.sh`

## Referenced scripts (heuristic union)

- Count: **144** (preflight + `$(SCRIPTS)/` + Makefile `bash scripts/...`)

## Missing files / legacy OCH paths
- _(none)_

## Environment documentation (leading banner)

Informational heuristic: `${VAR` expansions for `PREFLIGHT_*`, `CLUSTER_GUARD_*`, `PHASE_BARRIER_*`, `TRANSPORT_STUDY_*`, `JAEGER_*` that do not appear in the contiguous leading `#` block (often OK when documented later in-file).

- `JAEGER_OBSERVABILITY_NS` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `JAEGER_PF_LOCAL_PORT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `JAEGER_QUERY_BASE` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PHASE_BARRIER_POST_INTEGRATION_STABILIZE_SEC` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_3A_DID_REISSUE` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_ABORT_ON_503` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_ABORT_ON_SLOW_APPLY` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_APP_DEPLOYS` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_APP_SCOPE` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_AUTH_PRISMA_MIGRATE` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_CADDY_ROLLOUT_WAIT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_CAP` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_CI_PYTHON_TRANSPORT_VALIDATION` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_CI_TRANSPORT_GATES` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_CLUSTER_STABILITY_GUARD` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_ENSURE_IMAGES` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_EXIT_AFTER_HOUSING_SUITES` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_FORENSIC` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_FULL_EDGE_TRANSPORT_VALIDATION` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_GATEWAY_DRAIN_BEFORE_STEP7` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_GATEWAY_DRAIN_ROLLOUT_TIMEOUT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_JAEGER_PF_PID` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_JAEGER_PORT_FORWARD` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K3D_API_STABILIZE_SLOTS` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K3D_EXPECTED_NODES` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K3D_NODES_READY_WAIT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K6_MESSAGING_LIMIT_FINDER` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K8S_IMAGE_DRIFT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_K8S_IMAGE_VERIFY` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_KAFKA_ALIGNMENT_SUITE_SAFE_ONLY` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_KAFKA_SUBSTRATE` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_KAFKA_TLS_PREFLIGHT_JOB` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LISTINGS_K6_GATEWAY_LAB` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LISTINGS_LAB_DURATION` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LISTINGS_LAB_SKIP_LIMIT_FINDER` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LISTINGS_LAB_VUS` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LOCK_DIR` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_LOCK_TIMEOUT` — used as `${…}` in body; not spelled in contiguous leading `#` block
- `PREFLIGHT_MACOS_CA_AUTO_TRUST` — used as `${…}` in body; not spelled in contiguous leading `#` block
- _…76 more (informational only; not a hard failure)_

## Trace validators

- `scripts/trace-validators/` with `.mjs`: **yes**

## Observability / TLS / transport (spot checks)
- _(all spot-check paths present)_

## Secret alignment audit tool

- `tools/bundle-audit/secret_name_alignment_audit.py`: **present**

## OCH path tokens inside preflight body
- _(none)_

