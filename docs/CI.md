# CI: Production workflow

The main workflow is defined in [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs on every push and pull request and is designed to be deterministic, cache-friendly, and easy to maintain.

## Triggers and concurrency

- **Triggers:** `push`, `pull_request`
- **Concurrency:** `group: ci-${{ github.ref }}` with `cancel-in-progress: true`  
  New pushes on the same ref cancel in-progress runs, saving time and keeping PR checks aligned with the latest commit.

## Jobs overview

| Job | Purpose | Depends on |
|-----|---------|------------|
| **build** | Compile `@common/utils` and each service (matrix) | — |
| **test** | Run service tests (`pnpm run --if-present test`) per service | build |
| **docker-build** | Build Docker image per service with layer cache | build |
| **quic-invariants** | Enforce no IP-based HTTP/3 (hostname-only QUIC) | — |
| **transport-validation** | Validate transport tooling; optional pcap gate if `vm.pcap` exists | — |
| **python-ai** | Python AI service venv + deps + import sanity check | — |
| **artifacts** | Upload rotation reports if present (best-effort) | build, test |

## Build and test matrix

- **Build:** 9 services — api-gateway, auth-service, records-service, listings-service, analytics-service, messaging-service, shopping-service, auction-monitor, cron-jobs.
- **Test:** matrix matches build (minus python-ai-service pytest, which runs in coverage workflow); each job builds `@common/utils` then runs `pnpm -C services/<service> run --if-present test` (skips services with no `test` script).
- **Docker build:** 9 images — same 8 as test plus python-ai-service; build context is repo root, Dockerfile path `services/<service>/Dockerfile`.

Strategy is `fail-fast: false` so one failing service doesn’t cancel others; you see full matrix results.

## Caching

1. **pnpm (build and test jobs)**  
   `actions/setup-node` with `cache: pnpm` and `cache-dependency-path: pnpm-lock.yaml` so installs are cached per lockfile.

2. **Docker (docker-build job)**  
   `actions/cache@v4` stores Buildx cache under `/tmp/.buildx-cache`.  
   - **Key:** `${{ runner.os }}-${{ matrix.service }}-${{ github.sha }}`  
   - **Restore keys:** `${{ runner.os }}-${{ matrix.service }}-`  
   So the same service reuses cache from previous runs; each run saves a new cache for the current SHA.

## Artifacts

The **artifacts** job runs `if: always()` after build and test (whether they pass or fail). It uploads a **rotation-reports** artifact if any of these exist:

- `rotation-summary.json`
- `rotation-report.json`

`if-no-files-found: ignore` so the job doesn’t fail when no rotation was run (e.g. normal PRs). Useful when the rotation suite or other scripts produce these files.

## Environment and versions

- **Top-level env:** `NODE_VERSION: 20`, `PYTHON_VERSION: "3.11"`. Change these in one place to bump versions.
- **Actions:** Stable major tags only (`@v4`, `@v5`, `@v3`) — no floating refs, no SHA pinning required for normal use.
- **Build env (build job):** `DATABASE_URL`, `POSTGRES_*`, `REDIS_URL` are set so service builds that expect DB/Redis env still compile in CI.

## Transport validation

- **Without pcap:** Running `transport_validator.py` with no pcap is expected to return “no pcap provided”; CI treats that as success.
- **With pcap:** If `vm.pcap` exists in the repo (e.g. from a rotation run), CI installs tshark and requires the validator to output `"valid": true` for that pcap.

## Maintenance

- **Adding a service:** Add the service name to the `build` matrix (and to `test` / `docker-build` if it has tests or a Dockerfile). Ensure the service has a `build` script (and optionally `test` and a Dockerfile).
- **Node or Python version:** Update `env.NODE_VERSION` or `env.PYTHON_VERSION` in the workflow.
- **IDE “Unable to resolve action”:** Workflow files are associated as plain YAML in `.vscode/settings.json` so the GitHub Actions extension doesn’t run action resolution; the workflow still runs correctly on GitHub.

## Required status checks

In **Settings → Branches → Branch protection**, you can require the following to pass before merge:

- `Build (<service>)` for the services you care about (or rely on “all jobs must pass” if your host supports it).
- `Enforce QUIC hostname invariant`
- `Transport validation gate`
- `Python AI validation`
- Optionally `Test (<service>)` and `Docker build (<service>)` if you want tests and images gated.

The **artifacts** job is best-effort and does not need to be required.
