# Platform reuse: certs, 3-broker Kafka, alignment, preflight

## 1. Prerequisites

- **Kubernetes** with working **`kubectl`** (Colima + k3s or k3d per OCH docs in **`ENGINEERING.md`** / **`README.md`** in the main repo).
- **MetalLB** (or equivalent L2/LB) if you use the **external** listeners on **:9094** per broker — see **`infra/k8s/metallb/`** and **`infra/k8s/kafka-kraft-metallb/`**.
- **bash**, **openssl**, **keytool** (JDK), **curl** (8.19+ recommended for HTTP/3 experiments), optional **k6**, **docker** (for image build/import).
- **Node 18+** and **pnpm** for `pnpm verify:*` and any script that shells into the repo test stack.

## 2. Repo layout after unpack

Unpack so that **`scripts/`** and **`infra/k8s/`** sit next to each other the same way as OCH (repo root = parent of both). Set:

```bash
export REPO_ROOT="$PWD"   # directory that contains scripts/ and infra/
```

Many scripts derive `REPO_ROOT` from their own path; keep the tree intact.

## 3. Certificate generation (strict TLS / mTLS / Kafka JKS)

**Single source of truth for the dev CA:** **`certs/dev-root.pem`** at repo root (public) and **`certs/dev-root.key`** (private, gitignored).

1. **Bootstrap dev CA + edge leaf** (typical first run):  
   `./scripts/dev-generate-certs.sh`  
   Preflight also attempts this when assets are missing (see header of **`run-preflight-scale-and-all-suites.sh`**).

2. **Full reissue + sync to cluster** (rotation / drift):  
   `./scripts/reissue-ca-and-leaf-load-all-services.sh`  
   or **`pnpm run reissue`** when wired in your merged **`package.json`**.

3. **Kafka broker JKS / PEM for `och-kafka-ssl-secret`:**  
   `./scripts/kafka-ssl-from-dev-root.sh`  
   After MetalLB assigns external IPs, you may need **`KAFKA_SSL_EXTRA_IP_SANS=…`** so broker certs match **:9094** listeners. Details: **`infra/k8s/kafka-certs/README.md`** (included).

4. **Never commit keys** — see **`certs/README.txt`** and your org’s secret policy.

## 4. Three-broker KRaft + MetalLB

1. **Apply the bundle** (namespace + StatefulSet + Services + MetalLB hooks):  
   ```bash
   kubectl apply -k "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/"
   ```
   Wait for **`kafka-0` … `kafka-2`** Ready.

2. **Create event topics** (after brokers API is up):  
   ```bash
   ./scripts/create-kafka-event-topics-k8s.sh
   ```

3. **Optional cert-manager path:**  
   `kubectl apply -k "$REPO_ROOT/infra/k8s/kafka-certs/"` — see **`infra/k8s/kafka-certs/README.md`** for per-pod TLS vs JKS reality.

4. **Gates** (also exposed as **`pnpm verify:*`** in root **`package.json`**):  
   - **`scripts/verify-kafka-cluster.sh`** — quorum, leadership, APIs.  
   - **`scripts/verify-kafka-tls-sans.sh`** — SANs vs headless + external names/IPs.  
   - **`scripts/verify-kafka-kraft-advertised-listeners.sh`** — advertised.listeners vs MetalLB.

## 5. Kafka ↔ MetalLB alignment suite

**Script:** **`scripts/tests/kafka-alignment-suite.sh`**

- **Full (mutating) mode (default in preflight):** `KAFKA_ALIGNMENT_TEST_MODE=1` — simulated drift, remediate, broker churn, rollout checks.  
- **Safe-only:** `KAFKA_ALIGNMENT_TEST_MODE=0` or **`PREFLIGHT_KAFKA_ALIGNMENT_SUITE_SAFE_ONLY=1`** with preflight.

**Prometheus textfile metrics:** set **`NODE_EXPORTER_TEXTFILE_DIR`** to publish **`kafka_alignment_test_pass{test="…"}`**. CronJob example: **`infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`**.

**Remediation entrypoints:** **`./scripts/kafka-runtime-sync.sh`** (`--check-only` / `--remediate`), **`make kafka-sync-metallb`** (Makefile included).

## 6. Preflight driver

**`./scripts/run-preflight-scale-and-all-suites.sh`** orchestrates:

- API server / context checks (Colima vs k3d via **`REQUIRE_COLIMA`**).  
- Scale baseline, reissue CA/leaf, Caddy strict TLS checks, Kafka KRaft apply + health gates, **optional alignment suite (6a2c9)**, service readiness, Vitest stacks, k6 edge grid, **Playwright** via **`run-playwright-e2e-preflight.sh`**.

**Important env flags** (non-exhaustive — read script header for full list):

| Variable | Meaning |
|----------|--------|
| `REQUIRE_COLIMA=0` | k3d-style context (no Colima enforcement). |
| `METALLB_ENABLED=1` | MetalLB / LB paths for edge + Kafka external. |
| `PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=1` | Skip **`kafka-alignment-suite.sh`**. |
| `PREFLIGHT_KAFKA_ALIGNMENT_SUITE_SAFE_ONLY=1` | Alignment safe tests only. |
| `RUN_PREFLIGHT_PLAYWRIGHT=0` | Skip E2E. |
| `RUN_SUITES=0` | Skip test suites after infra gates. |

**Prep:** `./scripts/ensure-ready-for-preflight.sh` (if present). **Host tools:** `./scripts/install-preflight-tools.sh` (curl HTTP/3, tcpdump, tshark, htop, etc. on the **host** — separate from the Caddy image).

## 7. Playwright preflight

**`./scripts/run-playwright-e2e-preflight.sh`** waits for **`$E2E_API_BASE/api/readyz`**, optional Kafka waits, recovery barrier, then runs **`webapp-playwright-strict-edge.sh`**.

Requires a full checkout with **`webapp/`**, **`pnpm install`**, Playwright browsers, and **`certs/dev-root.pem`** (or **`NODE_EXTRA_CA_CERTS`**). Pair with the **Vitest/Playwright** reference tarball if you do not have **`webapp/`** in this tree.

## 8. Makefile targets

From repo root (after merging **Makefile** or copying targets):

- **`make apply-kafka-kraft`** / **`make kafka-health`** / **`make kafka-alignment-suite`** — thin wrappers over scripts; exact names may vary slightly by OCH version — run **`make help`** or grep **`Makefile`** for **`kafka-`**.

## 9. Merging into Record Platform

- Keep **paths** stable (`scripts/…`, `infra/k8s/…`) or mass-replace **`REPO_ROOT`** / **`HOUSING_NS`**.  
- Align **namespace** (this repo defaults to **`record-platform`**; override **`HOUSING_NS`** if your cluster differs) in manifests and exports.  
- Re-point **hostnames** (`off-campus-housing.test`) in edge scripts and **`Caddyfile`** / ConfigMaps.
