#!/usr/bin/env bash
# Record Platform cold-bootstrap — single operator entry (DAG discipline).
#
#   COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/rp-all-11-YYYYMMDD-HHMMSS make cold-bootstrap
#   COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap   # uses latest materialized or rp-all-11 backup
#
# Embeds: workspace → crypto → host infra → hybrid backup → restore → cluster bootstrap
# (make bootstrap) → transport hosts gate → cluster-doctor + verify-bootstrap-state + drift + artifacts.
# Do not run cluster-doctor separately; it is phase J inside this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export RP_CB_REPO_ROOT="$REPO_ROOT"
export RP_CB_DRY_RUN="${COLD_BOOTSTRAP_DRY_RUN:-0}"
export RP_CB_BENCH="$REPO_ROOT/bench_logs"
export RP_CB_GRAPH="$REPO_ROOT/infra/bootstrap_invariants.graph.json"
export RP_CB_PROGRESS="$REPO_ROOT/bench_logs/bootstrap_state_progress.json"
# pnpm@11 non-TTY installs (avoid ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY)
export CI="${CI:-true}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT="${COREPACK_ENABLE_DOWNLOAD_PROMPT:-0}"

# shellcheck source=scripts/lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=scripts/lib/rp-restore-resolve.sh
source "$SCRIPT_DIR/lib/rp-restore-resolve.sh"
# shellcheck source=scripts/lib/rp-cold-bootstrap-lib.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-lib.sh"
# shellcheck source=scripts/lib/rp-cold-bootstrap-kafka-tls.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-kafka-tls.sh"

export RP_SKIP_BOOKING_DB="${RP_SKIP_BOOKING_DB:-1}"
export RP_SKIP_BOOKING_SERVICE="${RP_SKIP_BOOKING_SERVICE:-${RP_SKIP_BOOKING_DB}}"
export RP_SKIP_SOCIAL_SERVICE="${RP_SKIP_SOCIAL_SERVICE:-1}"
export RP_CORE_ONLY_BOOTSTRAP="${RP_CORE_ONLY_BOOTSTRAP:-0}"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"
rp_ollama_policy_resolve
# shellcheck source=scripts/lib/rp-bootstrap-trust-mode.sh
source "$SCRIPT_DIR/lib/rp-bootstrap-trust-mode.sh"
rp_bootstrap_print_trust_banner
export RP_ENABLE_ANALYTICS_AI="${RP_ENABLE_ANALYTICS_AI:-0}"
export RP_ENABLE_HEAVY_OBS="${RP_ENABLE_HEAVY_OBS:-0}"
export RP_MINIMAL_BOOTSTRAP="${RP_MINIMAL_BOOTSTRAP:-1}"
export RP_PUBLIC_HOST="${RP_PUBLIC_HOST:-record-platform.test}"
export RP_PAUSE_FOR_HOSTS="${RP_PAUSE_FOR_HOSTS:-1}"
export RP_RESTORE_MODE="${RP_RESTORE_MODE:-hybrid}"
export HOSTS_AUTO="${HOSTS_AUTO:-0}"
export HOUSING_NS="${HOUSING_NS:-record-platform}"
export CADDY_PUBLIC_HOSTNAME="${CADDY_PUBLIC_HOSTNAME:-$RP_PUBLIC_HOST}"
export LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-record-platform-local-tls}"
export RP_CLUSTER_DOCTOR_MIN_SCORE="${RP_CLUSTER_DOCTOR_MIN_SCORE:-95}"
export COLD_BOOTSTRAP_QUIET="${COLD_BOOTSTRAP_QUIET:-1}"
export COLD_BOOTSTRAP_COLOR="${COLD_BOOTSTRAP_COLOR:-auto}"
export VERIFY_APP_RUNTIME_PHASE="${VERIFY_APP_RUNTIME_PHASE:-cold}"

if [[ "${COLD_BOOTSTRAP_CONFIRM:-}" != "yes" ]]; then
  echo "❌ Set COLD_BOOTSTRAP_CONFIRM=yes" >&2
  exit 1
fi

mkdir -p "$RP_CB_BENCH"
RP_CB_START_MS="$(rp_cb_ms_now)"
rp_cb_print_wall_timer_start
rp_cb_setup_log_tee
rp_cb_print_banner
rp_cb_print_operator_notes

node "$SCRIPT_DIR/derive-bootstrap-order.mjs" \
  --json-out "$RP_CB_BENCH/bootstrap_allowed_order.json" \
  --write-dot "$REPO_ROOT/infra/bootstrap_invariants.dot" >/dev/null 2>&1 || true

rp_cb_phase_guard --reset >/dev/null 2>&1 || true
rp_cb_progress_json

if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  rp_cb_plan_forbidden_audit
fi
rp_cb_print_allowed_order_json

# --- A.toolchain (Node 22 + pnpm 11 before workspace install) ---
rp_cb_phase_enter A.toolchain "Node 22 + pnpm 11.1.3 (fnm/corepack)"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-verify-toolchain-contract.sh" "$SCRIPT_DIR/lib/rp-ensure-node-pnpm.sh" 2>/dev/null || true
  # shellcheck source=scripts/lib/rp-ensure-node-pnpm.sh
  source "$SCRIPT_DIR/lib/rp-ensure-node-pnpm.sh"
  rp_ensure_node_pnpm "$REPO_ROOT" || rp_cb_phase_fail A.toolchain "toolchain failed" "bash scripts/rp-verify-toolchain-contract.sh"
  bash "$SCRIPT_DIR/rp-verify-toolchain-contract.sh" || rp_cb_phase_fail A.toolchain "toolchain contract failed" "bash scripts/rp-verify-toolchain-contract.sh"
  chmod +x "$SCRIPT_DIR/test-rp-colima-k3s-start-args.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/test-rp-colima-k3s-start-args.sh" || rp_cb_phase_fail A.toolchain "colima k3s-arg builder test failed" "make rp-test-colima-k3s-args"
  chmod +x "$SCRIPT_DIR/test-rp-edge-http3-smoke-parser.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/test-rp-edge-http3-smoke-parser.sh" || rp_cb_phase_fail A.toolchain "HTTP/3 smoke parser test failed" "make rp-test-edge-http3-smoke-parser"
  chmod +x "$SCRIPT_DIR/test-rp-edge-curl-probe-parser.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/test-rp-edge-curl-probe-parser.sh" || rp_cb_phase_fail A.toolchain "edge curl probe parser test failed" "make rp-test-edge-curl-probe-parser"
  chmod +x "$SCRIPT_DIR/test-rp-kafka-gate-ssl.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/test-rp-kafka-gate-ssl.sh" || rp_cb_phase_fail A.toolchain "kafka gate SSL test failed" "make rp-test-kafka-gate-ssl"
  chmod +x "$SCRIPT_DIR/test-rp-pki-secret-annotations.sh" 2>/dev/null || true
  RP_ALLOW_MISSING_PKI_GENERATION=1 bash "$SCRIPT_DIR/test-rp-pki-secret-annotations.sh" || rp_cb_phase_fail A.toolchain "PKI secret annotations test failed" "make rp-test-pki-secret-annotations"
else
  echo "[dry-run] rp_ensure_node_pnpm + rp-verify-toolchain-contract.sh"
fi
rp_cb_phase_complete A.toolchain

# --- A.workspace (workspace invariant before destructive reset) ---
rp_cb_phase_enter A.workspace "kafka-alignment venv + pnpm install --frozen-lockfile + pnpm run build"
printf '\n=== Workspace bootstrap invariant ===\n'
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  rp_run_native A.workspace kafka-alignment-venv make -C "$REPO_ROOT" kafka-alignment-report-venv || \
    rp_cb_phase_fail A.workspace "kafka-alignment-report-venv failed" "make kafka-alignment-report-venv"
  if [[ "${COLD_BOOTSTRAP_SKIP_WORKSPACE_BUILD:-0}" != "1" ]]; then
    rp_run_native A.workspace pnpm-install pnpm install --frozen-lockfile || \
      rp_cb_phase_fail A.workspace "pnpm install failed" "pnpm install --frozen-lockfile"
    rp_run_native A.workspace pnpm-build pnpm run build || \
      rp_cb_phase_fail A.workspace "pnpm run build failed" "pnpm run build"
  fi
  test -s tools/kafka-contract/dist/index.js || rp_cb_phase_fail A.workspace "missing tools/kafka-contract/dist/index.js" "pnpm run build"
  rp_cb_assert_workspace_no_booking_social || rp_cb_phase_fail A.workspace "booking/social in workspace" "remove services/booking-service and social-service from workspace"
  rp_cb_ok "workspace invariant OK"
else
  echo "[dry-run] make kafka-alignment-report-venv && pnpm install --frozen-lockfile && pnpm run build"
  rp_cb_ok "workspace invariant OK (dry-run)"
fi
if [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ "${COLD_BOOTSTRAP_SKIP_GATES:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" 2>/dev/null || true
  RP_GATE_WORKSPACE_MODE=forbidden bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" workspace || \
    rp_cb_phase_fail A.workspace "gate workspace failed" "bash scripts/rp-cold-bootstrap-gates.sh workspace"
else
  rp_cb_ok "skip workspace gate (dry-run or COLD_BOOTSTRAP_SKIP_GATES=1)"
fi
rp_cb_phase_complete A.workspace

# --- P0.hard_reset (destructive boundary — before Colima start) ---
rp_cb_phase_enter P0.hard_reset "destructive reset"
if [[ "${COLD_BOOTSTRAP_SKIP_COLIMA_RESET:-0}" == "1" ]] || [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '  ▶ kill jobs\n  ✅ kill jobs\n'
    printf '  ▶ colima stop/delete + rm ~/.colima\n  ✅ colima factory reset complete\n'
    rp_cb_ok "P0 hard reset complete (dry-run)"
  else
    rp_cb_ok "skip P0.hard_reset (COLD_BOOTSTRAP_SKIP_COLIMA_RESET=1)"
  fi
else
  bash "$SCRIPT_DIR/rp-hard-reset.sh" || rp_cb_phase_fail P0.hard_reset "rp-hard-reset failed" "bash scripts/rp-hard-reset.sh"
fi
rp_cb_phase_complete P0.hard_reset

# --- Z.colima_clean (Colima+k3s, settle, VM tools, kubeconfig bridge) ---
rp_cb_phase_enter Z.colima_clean "start Colima+k3s + bridge kubeconfig + VM capture tools"
if [[ "${COLD_BOOTSTRAP_SKIP_COLIMA_RESET:-0}" == "1" ]] || [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '  ▶ colima-start\n  [dry-run] colima start --kubernetes ...\n  ✅ colima-start\n'
    printf 'Waiting 90s for k3s to settle\n  90\n  75\n  60\n  45\n  30\n  15\n  done\n✅ k3s settled\n'
    printf '\n[Z.colima_clean] VM tools\n'
    printf '  ▶ install-capture-tools\n    ▶ install tcpdump\n    ✅ tcpdump\n    ▶ install tshark\n    ✅ tshark\n    ▶ install htop\n    ✅ htop\n    ▶ install strace\n    ✅ strace\n'
    printf '  ▶ install-xcaddy\n    ▶ install xcaddy\n    ✅ xcaddy\n✅ VM tools installed\n'
    rp_cb_ok "Z.colima_clean complete (dry-run)"
  else
    rp_cb_ok "skip Z.colima_clean (COLD_BOOTSTRAP_SKIP_COLIMA_RESET=1)"
  fi
else
  bash "$SCRIPT_DIR/rp-colima-start-clean.sh" || rp_cb_phase_fail Z.colima_clean "rp-colima-start-clean failed" "bash scripts/rp-colima-start-clean.sh"
fi
export RP_COLD_BOOTSTRAP_RESET_DONE=1
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  # shellcheck source=scripts/lib/rp-runtime-image-state.sh
  source "$SCRIPT_DIR/lib/rp-runtime-image-state.sh"
  rp_print_runtime_image_state dev "after P0 hard reset + Z.colima_clean"
fi
rp_cb_phase_complete Z.colima_clean

# --- P1.host_deps (after Colima+k3s — validates docker/kube context) ---
rp_cb_phase_enter P1.host_deps "node + docker + curl HTTP/3 + openssl + kubectl + pip==26.1.1"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  rp_run_native P1.host_deps host-deps bash "$SCRIPT_DIR/rp-bootstrap-host-deps.sh" || \
    rp_cb_phase_fail P1.host_deps "host deps failed" "bash scripts/rp-bootstrap-host-deps.sh"
else
  echo "[dry-run] bash scripts/rp-bootstrap-host-deps.sh"
fi
rp_cb_phase_complete P1.host_deps

# --- B.crypto (3-stage PKI + Kafka JKS + K8s TLS secrets — fully embedded, idempotent) ---
rp_cb_phase_enter B.crypto "rm stale kafka-ssl → 3-stage certs → Kafka JKS → proof → strict-tls-bootstrap"
if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  echo "[dry-run] bash scripts/rp-bootstrap-crypto.sh"
else
  chmod +x "$SCRIPT_DIR/rp-bootstrap-crypto.sh" 2>/dev/null || true
  export RP_CRYPTO_SUPPRESS_STEPS="${COLD_BOOTSTRAP_QUIET:-1}"
  export RP_CB_RUN_LABEL="B.crypto — dev PKI + Kafka JKS"
  rp_cb_run bash "$SCRIPT_DIR/rp-bootstrap-crypto.sh" || \
    rp_cb_phase_fail B.crypto "rp-bootstrap-crypto failed" "bash scripts/rp-bootstrap-crypto.sh"
  if [[ "${COLD_BOOTSTRAP_SKIP_GATES:-0}" != "1" ]]; then
    bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" certs || \
      rp_cb_phase_fail B.crypto "gate certs failed" "bash scripts/rp-cold-bootstrap-gates.sh certs"
  fi
fi
_B_CRYPTO_START_MS="${RP_CB_PHASE_START_MS:-}"
rp_cb_phase_complete B.crypto
if [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ -n "$_B_CRYPTO_START_MS" ]]; then
  _crypto_mode="destructive"
  [[ "${RP_CRYPTO_RESET:-1}" == "0" ]] && _crypto_mode="non-destructive"
  rp_cb_record_phase_ms "B.crypto:${_crypto_mode}" "$_B_CRYPTO_START_MS"
fi

# --- C.infra (host DB substrate; TLS secrets already applied in B.crypto) ---
rp_cb_phase_enter C.infra "compose 5433–5443 + Redis 6379 + MinIO (external infra only)"
if rp_cb_color_enabled; then
  printf '\n\033[1m[P3] EXTERNAL INFRA\033[0m — compose up (restore is E.restore only)\n'
else
  printf '\n[P3] EXTERNAL INFRA — compose up (restore is E.restore only)\n'
fi
# shellcheck source=scripts/lib/ensure-colima-docker-context.sh
source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
OCH_FORCE_COLIMA_DOCKER=1 och_ensure_colima_docker_context || \
  rp_cb_phase_fail C.infra "Docker Desktop vs Colima conflict (or Colima docker socket down)" \
    "quit Docker Desktop; DOCKER_HOST=unix://\$HOME/.colima/default/docker.sock docker context use colima"
export RP_CB_RUN_LABEL="stop legacy external containers"
rp_cb_run bash "$SCRIPT_DIR/rp-stop-external-runtime-containers.sh"
export RP_CB_RUN_LABEL="verify compose contract"
rp_cb_run bash "$SCRIPT_DIR/rp-verify-compose-contract.sh" || \
  rp_cb_phase_fail C.infra "compose contract failed" "bash scripts/rp-verify-compose-contract.sh"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  rp_run_quiet C.infra docker-compose-config docker compose -f docker-compose.yml config || \
    rp_cb_phase_fail C.infra "docker compose config invalid" "see bench_logs/command-logs/C.infra/docker-compose-config.log"
  rp_cb_ok "docker compose config OK"
  _compose_up_args=(-f docker-compose.yml up -d)
  [[ "${COLD_BOOTSTRAP_FORCE_COMPOSE_RECREATE:-0}" == "1" ]] && _compose_up_args+=(--force-recreate)
  _compose_svcs=(
    redis minio
    postgres-records postgres-messaging postgres-listings postgres-shopping postgres-auth
    postgres-auction-monitor-core postgres-analytics postgres-python-ai
    postgres-notification postgres-trust postgres-media
  )
  export COMPOSE_PROGRESS="${COMPOSE_PROGRESS:-quiet}"
  rp_run_quiet C.infra compose-up docker compose "${_compose_up_args[@]}" "${_compose_svcs[@]}" || \
    rp_cb_phase_fail C.infra "docker compose up failed" "see bench_logs/command-logs/C.infra/compose-up.log"
  export RP_CB_RUN_LABEL="verify external runtime ports"
  rp_cb_run bash "$SCRIPT_DIR/rp-verify-external-runtime-ports.sh" || rp_cb_phase_fail C.infra "RP external ports check failed" "bash scripts/rp-verify-external-runtime-ports.sh"
  export RP_CB_RUN_LABEL="audit active runtime network"
  rp_cb_run bash "$SCRIPT_DIR/rp-audit-no-localhost-nodeport.sh" || rp_cb_phase_fail C.infra "runtime network audit failed" "bash scripts/rp-audit-no-localhost-nodeport.sh"
  echo "ℹ️  docs/reference legacy porting strings ignored by runtime audit; run: make rp-audit-porting-docs"
  if [[ "${COLD_BOOTSTRAP_SKIP_GATES:-0}" != "1" ]]; then
    bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" workspace || rp_cb_phase_fail C.infra "gate workspace/runtime failed" "bash scripts/rp-cold-bootstrap-gates.sh workspace"
  fi
fi
rp_cb_phase_complete C.infra

# --- D.backup_materialization ---
rp_cb_phase_enter D.backup_materialization "resolve RP runtime backup + validate 11 DBs"
if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  export RP_RESTORE_DRY_RUN=1
  rp_resolve_restore_backup_dir "${RESTORE_BACKUP_DIR:-latest}" || rp_cb_phase_fail D.backup_materialization "resolve failed" "RESTORE_BACKUP_DIR=backups/rp-all-11-YYYYMMDD-HHMMSS or latest"
  unset RP_RESTORE_DRY_RUN
else
  # shellcheck disable=SC1090
  eval "$(bash "$SCRIPT_DIR/resolve-rp-restore-backup-dir.sh" "${RESTORE_BACKUP_DIR:-latest}")" || rp_cb_phase_fail D.backup_materialization "resolve failed" "RESTORE_BACKUP_DIR=backups/rp-all-11-YYYYMMDD-HHMMSS or latest"
fi
[[ -n "${RESTORE_BACKUP_DIR:-}" && -n "${RESTORE_BACKUP_DIR_ABS:-}" ]] || \
  rp_cb_phase_fail D.backup_materialization "resolve produced empty RESTORE_BACKUP_DIR" "bash scripts/resolve-rp-restore-backup-dir.sh <dir>"
# resolve-rp-restore-backup-dir.sh exports RESTORE_BACKUP_DIR (relative) + RESTORE_BACKUP_DIR_ABS
echo "  source=${RP_RESTORE_SOURCE_INPUT:-?} → restore_from=$RESTORE_BACKUP_DIR (layout=${RP_RESTORE_LAYOUT:-?})"
export RP_CB_RUN_LABEL="validate hybrid backup"
rp_cb_run bash "$REPO_ROOT/backups/hybrid-rp-och/validate-hybrid-backup.sh" "$RESTORE_BACKUP_DIR_ABS" || \
  rp_cb_phase_fail D.backup_materialization "validate-hybrid-backup failed" "bash backups/hybrid-rp-och/validate-hybrid-backup.sh $RESTORE_BACKUP_DIR"
if [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ "${COLD_BOOTSTRAP_SKIP_GATES:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" backup || rp_cb_phase_fail D.backup_materialization "gate backup failed" "bash scripts/rp-cold-bootstrap-gates.sh backup"
fi
rp_cb_phase_complete D.backup_materialization

# --- E.restore (dump restore only — SKIP_COMPOSE_UP=1; not a second compose up) ---
rp_cb_phase_enter E.restore "restore 5433–5443 only (booking/social skipped)"
export SKIP_COMPOSE_UP=1
export SKIP_AUTO_RESTORE=0
export RP_CB_RUN_LABEL="hybrid restore (bring-up-external-infra, SKIP_COMPOSE_UP=1)"
rp_cb_run env RESTORE_BACKUP_DIR="$RESTORE_BACKUP_DIR_ABS" bash "$SCRIPT_DIR/bring-up-external-infra.sh" || \
  rp_cb_phase_fail E.restore "hybrid restore failed" "RESTORE_BACKUP_DIR=$RESTORE_BACKUP_DIR_ABS bash scripts/bring-up-external-infra.sh"
if [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ -x "$SCRIPT_DIR/verify-restore-data.sh" ]] && [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
  export RP_CB_RUN_LABEL="verify restore data"
  rp_cb_run bash "$SCRIPT_DIR/verify-restore-data.sh" || rp_cb_phase_fail E.restore "verify-restore-data failed" "bash scripts/verify-restore-data.sh"
fi
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" workspace || rp_cb_phase_fail E.restore "gate post-restore ports failed" "bash scripts/rp-cold-bootstrap-gates.sh workspace"
else
  rp_cb_ok "skip post-restore port gate (dry-run — compose not started)"
fi
rp_cb_phase_complete E.restore

# --- C.metrics (DAG: after E.restore, before C.images / F.cluster_deploy) ---
rp_cb_phase_enter C.metrics "metrics-server (kube-system)"
rp_cb_ensure_kube_api "before C.metrics" || rp_cb_phase_fail C.metrics "kube API bridge align failed" "re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  rp_cb_run env REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/bootstrap-metrics-server.sh" || \
    rp_cb_phase_fail C.metrics "bootstrap-metrics-server failed" "bash scripts/bootstrap-metrics-server.sh"
fi
rp_cb_phase_complete C.metrics

# --- C.images ---
rp_cb_phase_enter C.images "required images → Colima VM Docker"
rp_cb_ensure_kube_api "before C.images" || rp_cb_phase_fail C.images "kube API bridge align failed" "re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-audit-runtime-service-list.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="audit runtime service lists"
  rp_cb_run bash "$SCRIPT_DIR/rp-audit-runtime-service-list.sh" || \
    rp_cb_phase_fail C.images "runtime service list audit failed" "bash scripts/rp-audit-runtime-service-list.sh"
  chmod +x "$SCRIPT_DIR/rp-build-required-images.sh" "$SCRIPT_DIR/ensure-required-images.sh" \
    "$SCRIPT_DIR/verify-required-images.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="build required diagnostic images"
  rp_cb_run bash "$SCRIPT_DIR/rp-build-required-images.sh" || \
    rp_cb_phase_fail C.images "rp-build-required-images failed" "bash scripts/rp-build-required-images.sh"
  export RP_SKIP_REQUIRED_IMAGE_BUILD=1
  export RP_CB_RUN_LABEL="load required images into Colima VM Docker"
  rp_cb_run bash "$SCRIPT_DIR/ensure-required-images.sh" || \
    rp_cb_phase_fail C.images "ensure-required-images failed" "bash scripts/ensure-required-images.sh"
  export RP_CB_RUN_LABEL="verify required images"
  rp_cb_run bash "$SCRIPT_DIR/verify-required-images.sh" || \
    rp_cb_phase_fail C.images "verify-required-images failed" "bash scripts/verify-required-images.sh"
fi
rp_cb_phase_complete C.images

# --- C.image_contract (static Dockerfile contract; optional full docker build) ---
rp_cb_phase_enter C.image_contract "runtime Docker image contracts (before cluster deploy)"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-verify-image-build-contract.sh" \
    "$SCRIPT_DIR/test-rp-webapp-standalone-contract.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="verify image build contract (static)"
  rp_cb_run bash "$SCRIPT_DIR/rp-verify-image-build-contract.sh" || \
    rp_cb_phase_fail C.image_contract "image build contract failed" "bash scripts/rp-verify-image-build-contract.sh"
  export RP_CB_RUN_LABEL="verify webapp standalone contract (static)"
  rp_cb_run env RP_COLD_BOOTSTRAP=1 RP_WEBAPP_CONTRACT_MODE=static bash "$SCRIPT_DIR/test-rp-webapp-standalone-contract.sh" || \
    rp_cb_phase_fail C.image_contract "webapp standalone contract failed" "RP_WEBAPP_CONTRACT_MODE=static bash scripts/test-rp-webapp-standalone-contract.sh"
  chmod +x "$SCRIPT_DIR/rp-verify-kustomize-app-services.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="verify kustomize app Services + Deployments"
  rp_cb_run bash "$SCRIPT_DIR/rp-verify-kustomize-app-services.sh" || \
    rp_cb_phase_fail C.image_contract "kustomize app service contract failed" "bash scripts/rp-verify-kustomize-app-services.sh"
  if [[ "${RP_IMAGE_CONTRACT_BUILD:-0}" == "1" ]]; then
    export RP_CB_RUN_LABEL="docker build all runtime images (RP_IMAGE_CONTRACT_BUILD=1)"
    rp_cb_run env RP_IMAGE_CONTRACT_BUILD=1 bash "$SCRIPT_DIR/rp-verify-image-build-contract.sh" || \
      rp_cb_phase_fail C.image_contract "full image contract docker build failed" "RP_IMAGE_CONTRACT_BUILD=1 bash scripts/rp-verify-image-build-contract.sh"
  fi
else
  echo "[dry-run] bash scripts/rp-verify-image-build-contract.sh"
  echo "[dry-run] RP_WEBAPP_CONTRACT_MODE=static bash scripts/test-rp-webapp-standalone-contract.sh"
  echo "[dry-run] bash scripts/rp-verify-kustomize-app-services.sh"
  echo "[dry-run] optional: RP_IMAGE_CONTRACT_BUILD=1 bash scripts/rp-verify-image-build-contract.sh"
fi
rp_cb_phase_complete C.image_contract

# --- D.contract_audits (source/gateway/probe audits before image build) ---
rp_cb_phase_enter D.contract_audits "RP contract audits (gateway, runtime, probes, health)"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  export RP_CB_RUN_LABEL="make rp-audit-bootstrap-contract"
  rp_cb_run make rp-audit-bootstrap-contract || \
    rp_cb_phase_fail D.contract_audits "rp-audit-bootstrap-contract failed" "make rp-audit-bootstrap-contract"
else
  echo "[dry-run] make rp-audit-bootstrap-contract"
fi
rp_cb_phase_complete D.contract_audits

# --- E.build_images (all active :dev images with RP_SOURCE_SHA) ---
rp_cb_phase_enter E.build_images "build active RP :dev images (RP_SOURCE_SHA per service)"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  echo ""
  echo "ℹ️  P0 hard reset wiped Colima Docker; E.build_images is the only runtime image build phase."
  echo "   C.image_contract is static-only (no record-platform-webapp:contract docker build)."
  echo ""
  # shellcheck source=scripts/lib/ensure-colima-docker-context.sh
  source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
  export OCH_FORCE_COLIMA_DOCKER=1
  och_ensure_colima_docker_context || rp_cb_phase_fail E.build_images "Colima docker context failed" "colima start; docker context use colima"
  export RP_CB_RUN_LABEL="make rp-build-missing-images"
  export RP_COLD_BOOTSTRAP=1
  rp_cb_run make rp-build-missing-images || \
    rp_cb_phase_fail E.build_images "rp-build-missing-images failed" "make rp-build-missing-images"
else
  echo "[dry-run] make rp-build-missing-images"
fi
rp_cb_phase_complete E.build_images

# --- E.image_freshness (hard gate — no stale trust/gateway images) ---
rp_cb_phase_enter E.image_freshness "verify image freshness labels (rp.dev.source-sha)"
if [[ "${RP_SKIP_IMAGE_FRESHNESS:-0}" == "1" ]]; then
  echo ""
  echo "⚠️  RP_SKIP_IMAGE_FRESHNESS=1 — allowing stale images; cold-bootstrap result is not trusted"
  echo ""
elif [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/audit-rp-image-freshness.sh" "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="audit-rp-image-freshness.sh"
  rp_cb_run bash "$SCRIPT_DIR/audit-rp-image-freshness.sh" || \
    rp_cb_phase_fail E.image_freshness "image freshness audit failed" "make build-images && bash scripts/audit-rp-image-freshness.sh"
else
  echo "[dry-run] bash scripts/audit-rp-image-freshness.sh"
fi
rp_cb_phase_complete E.image_freshness

# --- F.cluster_deploy (nested make bootstrap — quiet log) ---
rp_cb_phase_enter F.cluster_deploy "cluster deploy via bootstrap-cluster.sh (BOOTSTRAP_SKIP_INFRA=1)"
_F_CLUSTER_START_MS="$(rp_cb_ms_now)"
_F_TIMING_JSON="${RP_CB_BENCH}/phase-timings/F.cluster_deploy.json"
mkdir -p "${RP_CB_BENCH}/phase-timings"
rp_cb_ensure_kube_api "before F.cluster_deploy / make bootstrap" || \
  rp_cb_phase_fail F.cluster_deploy "kube API bridge align failed" "re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap"
if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  echo "[dry-run] BOOTSTRAP_CONFIRM=yes BOOTSTRAP_SKIP_RESET=1 BOOTSTRAP_SKIP_P0=1 BOOTSTRAP_SKIP_INFRA=1 make bootstrap"
  echo "[dry-run] namespace ensure (no delete record-platform)"
else
  if command -v kubectl >/dev/null 2>&1; then
    _F_NS_START_MS="$(rp_cb_ms_now)"
    export RP_CB_RUN_LABEL="namespace ensure"
    rp_cb_run env \
      RP_FORCE_NAMESPACE_DELETE="${RP_FORCE_NAMESPACE_DELETE:-0}" \
      RP_COLD_BOOTSTRAP_RESET_DONE="${RP_COLD_BOOTSTRAP_RESET_DONE:-1}" \
      bash "$SCRIPT_DIR/rp-clean-old-namespaces.sh" || \
      rp_cb_phase_fail F.cluster_deploy "namespace ensure failed" "bash scripts/rp-clean-old-namespaces.sh"
    _F_NS_END_MS="$(rp_cb_ms_now)"
  fi
  # shellcheck source=scripts/lib/ensure-colima-docker-context.sh
  source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
  export OCH_FORCE_COLIMA_DOCKER=1
  export OCH_KUBE_CONTEXT="${OCH_KUBE_CONTEXT:-colima}"
  och_ensure_colima_docker_context || rp_cb_phase_fail F.cluster_deploy "Colima docker context failed" "colima start; docker context use colima"
  chmod +x "$SCRIPT_DIR/rp-audit-runtime-service-list.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="audit runtime service lists (pre cluster deploy)"
  rp_cb_run bash "$SCRIPT_DIR/rp-audit-runtime-service-list.sh" || \
    rp_cb_phase_fail F.cluster_deploy "runtime service list audit failed" "bash scripts/rp-audit-runtime-service-list.sh"
  if [[ "${RP_SKIP_IMAGE_FRESHNESS:-0}" != "1" ]]; then
    export RP_CB_RUN_LABEL="re-check image freshness before deploy"
    rp_cb_run bash "$SCRIPT_DIR/audit-rp-image-freshness.sh" || \
      rp_cb_phase_fail F.cluster_deploy "image freshness re-check failed" "make rp-build-and-audit-images"
  fi

  # BOOTSTRAP_SKIP_INFRA=1 assumes C.infra left Redis/Postgres up; they are often SIGTERM'd
  # before F (compose stop / docker recycle). Re-assert via allowlisted helper (no 127.0.0.1 here).
  export RP_CB_RUN_LABEL="ensure compose redis+postgres still published (pre F)"
  rp_cb_ensure_compose_external_infra || \
    rp_cb_phase_fail F.cluster_deploy "compose external infra not published" \
      "source scripts/lib/rp-cold-bootstrap-lib.sh && rp_cb_ensure_compose_external_infra"

  export BOOTSTRAP_CONFIRM=yes
  export BOOTSTRAP_SKIP_RESET=1
  export BOOTSTRAP_SKIP_P0=1
  export BOOTSTRAP_SKIP_P0B=1
  export BOOTSTRAP_SKIP_P1=1
  export BOOTSTRAP_SKIP_P1B=1
  export BOOTSTRAP_SKIP_P1C=1
  export BOOTSTRAP_SKIP_COLIMA_AUTO_RECOVER=1
  export BOOTSTRAP_SKIP_COLIMA=1
  export BOOTSTRAP_FULL_WIPE=0
  export BOOTSTRAP_SKIP_INFRA=1
  export RP_COLD_BOOTSTRAP_RESET_DONE=1
  export METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
  # Kafka owns pool start (.240-.242); ollama/caddy take later free IPs. Offset 1 collides with ollama-lb.
  export KAFKA_METALLB_FIRST_OFFSET="${KAFKA_METALLB_FIRST_OFFSET:-0}"
  export KAFKA_PIN_METALLB_EXTERNAL_AFTER_SVC_APPLY="${KAFKA_PIN_METALLB_EXTERNAL_AFTER_SVC_APPLY:-0}"
  export KAFKA_SKIP_METALLB_EXTERNAL_PIN="${KAFKA_SKIP_METALLB_EXTERNAL_PIN:-1}"
  export KAFKA_LB_WAIT_MAX_ATTEMPTS="${KAFKA_LB_WAIT_MAX_ATTEMPTS:-120}"
  export SKIP_AUTO_RESTORE=1
  export SKIP_BOOTSTRAP=1
  export RESTORE_BACKUP_DIR=
  export BOOTSTRAP_SKIP_P6_RUNTIME_IMAGES=1
  export RP_COLD_BOOTSTRAP_IMAGES_BUILT=1
  export BOOTSTRAP_SKIP_PHASE_GUARD="${BOOTSTRAP_SKIP_PHASE_GUARD:-0}"
  export BOOTSTRAP_SKIP_LOCAL_CRYPTO_INVARIANT=1
  export BOOTSTRAP_RESUME="${BOOTSTRAP_RESUME:-0}"
  export RP_USE_BRIDGE_KUBECONFIG=1
  rm -f "${RP_CB_BENCH}/.rp-kafka-staged-apply-guard" 2>/dev/null || true
  export RP_KAFKA_STAGED_APPLY_GUARD="${RP_CB_BENCH}/.rp-kafka-staged-apply-guard"
  _F_BOOT_START_MS="$(rp_cb_ms_now)"
  rp_cb_run_bootstrap_cluster || rp_cb_phase_fail F.cluster_deploy "make bootstrap failed" "see bench_logs/bootstrap-cluster.log"
  _F_BOOT_END_MS="$(rp_cb_ms_now)"

  _F_KAFKA_START_MS="$(rp_cb_ms_now)"
  rp_cb_run rp_cb_refresh_kafka_tls_after_metallb || \
    rp_cb_phase_fail F.cluster_deploy "Kafka TLS refresh after MetalLB failed" "bash scripts/kafka-refresh-tls-from-lb.sh"
  _F_KAFKA_END_MS="$(rp_cb_ms_now)"

  export RP_CB_RUN_LABEL="audit K8s service TLS secrets (post-deploy)"
  rp_cb_run bash "$SCRIPT_DIR/audit-rp-k8s-service-tls-secrets.sh" || \
    rp_cb_phase_fail F.cluster_deploy "audit-rp-k8s-service-tls-secrets failed" "bash scripts/strict-tls-bootstrap.sh"

  if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE:-1}" == "1" ]]; then
    export RP_CB_RUN_LABEL="apply Ollama MetalLB service"
    rp_cb_run bash "$SCRIPT_DIR/apply-ollama-metallb-lb.sh" || \
      rp_cb_phase_fail F.cluster_deploy "apply-ollama-metallb-lb failed" "bash scripts/apply-ollama-metallb-lb.sh"
    export RP_CB_RUN_LABEL="audit + smoke Ollama stack"
    rp_cb_run bash "$SCRIPT_DIR/audit-rp-ollama-stack.sh" || {
      bash "$SCRIPT_DIR/diagnose-rp-ollama.sh" >&2 || true
      rp_cb_phase_fail F.cluster_deploy "audit-rp-ollama-stack failed" "bash scripts/diagnose-rp-ollama.sh"
    }
    rp_cb_run bash "$SCRIPT_DIR/smoke-rp-ollama.sh" || \
      rp_cb_phase_fail F.cluster_deploy "smoke-rp-ollama failed" "bash scripts/diagnose-rp-ollama.sh"
  else
    rp_cb_ok "Ollama stack skipped (core-only bootstrap)"
  fi

  _F_CLUSTER_END_MS="$(rp_cb_ms_now)"
  export F_CLUSTER_START_MS="${_F_CLUSTER_START_MS:-}" \
    F_NS_START_MS="${_F_NS_START_MS:-}" F_NS_END_MS="${_F_NS_END_MS:-}" \
    F_BOOT_START_MS="${_F_BOOT_START_MS:-}" F_BOOT_END_MS="${_F_BOOT_END_MS:-}" \
    F_KAFKA_START_MS="${_F_KAFKA_START_MS:-}" F_KAFKA_END_MS="${_F_KAFKA_END_MS:-}" \
    F_CLUSTER_END_MS="${_F_CLUSTER_END_MS:-}" \
    RP_CB_BOOTSTRAP_LOG="${RP_CB_BOOTSTRAP_LOG:-${RP_CB_BENCH}/bootstrap-cluster.log}"
  python3 - "$_F_TIMING_JSON" <<'PY' 2>/dev/null || true
import json, os, sys
from datetime import datetime, timezone
out = sys.argv[1]
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def ms(k):
    v = os.environ.get(k, "")
    return int(v) if str(v).isdigit() else None

def dur(a, b):
    if a is None or b is None:
        return None
    return max(0, b - a)

steps = {}
for key, label in [
    ("F_NS_START_MS", "namespace_ensure"),
    ("F_NS_END_MS", "namespace_ensure_end"),
    ("F_BOOT_START_MS", "bootstrap_cluster"),
    ("F_BOOT_END_MS", "bootstrap_cluster_end"),
    ("F_KAFKA_START_MS", "kafka_tls_refresh_after_metallb"),
    ("F_KAFKA_END_MS", "kafka_tls_refresh_end"),
]:
    t = ms(key)
    if t is not None:
        steps[label] = {"ms": t}

payload = {
    "phase": "F.cluster_deploy",
    "recorded_at": now,
    "total_ms": dur(ms("F_CLUSTER_START_MS"), ms("F_CLUSTER_END_MS")),
    "namespace_ensure_ms": dur(ms("F_NS_START_MS"), ms("F_NS_END_MS")),
    "bootstrap_cluster_ms": dur(ms("F_BOOT_START_MS"), ms("F_BOOT_END_MS")),
    "kafka_tls_refresh_ms": dur(ms("F_KAFKA_START_MS"), ms("F_KAFKA_END_MS")),
    "steps": steps,
    "bootstrap_log": os.environ.get("RP_CB_BOOTSTRAP_LOG", ""),
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
    fh.write("\n")
PY

  if [[ "${BOOTSTRAP_SKIP_DB_SCHEMA_INSPECT:-0}" != "1" ]] && [[ -x "$SCRIPT_DIR/inspect-external-db-schemas.sh" ]]; then
    rp_cb_run bash "$SCRIPT_DIR/inspect-external-db-schemas.sh" bench_logs
  fi

  mkdir -p "$RP_CB_BENCH"
  python3 "$SCRIPT_DIR/cluster_health_dag.py" bootstrap --ns "${HOUSING_NS}" --repo "$REPO_ROOT" || \
    rp_cb_phase_fail F.cluster_deploy "cluster_health_dag bootstrap score/DAG failed" "python3 scripts/cluster_health_dag.py bootstrap --ns $HOUSING_NS --repo ."
  if [[ "${COLD_BOOTSTRAP_SKIP_GATES:-0}" != "1" ]]; then
    bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" kafka || rp_cb_phase_fail F.cluster_deploy "gate kafka failed" "bash scripts/rp-cold-bootstrap-gates.sh kafka"
    bash "$SCRIPT_DIR/rp-cold-bootstrap-gates.sh" k8s || rp_cb_phase_fail F.cluster_deploy "gate k8s failed" "bash scripts/rp-cold-bootstrap-gates.sh k8s"
  fi
fi
rp_cb_phase_complete F.cluster_deploy

rp_cb_phase_enter G.app_runtime
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/audit-rp-runtime-health-contract.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="audit-rp-runtime-health-contract --mode live"
  rp_cb_run bash "$SCRIPT_DIR/audit-rp-runtime-health-contract.sh" --mode live || \
    rp_cb_phase_fail G.app_runtime "live runtime health contract failed" "bash scripts/audit-rp-runtime-health-contract.sh --mode live"
  if [[ -x "$SCRIPT_DIR/verify-app-runtime.sh" ]]; then
    rp_cb_run env VERIFY_APP_RUNTIME_PHASE=cold HOUSING_NS="${HOUSING_NS:-record-platform}" \
      bash "$SCRIPT_DIR/verify-app-runtime.sh" || \
      rp_cb_phase_fail G.app_runtime "verify-app-runtime failed" "VERIFY_APP_RUNTIME_PHASE=cold bash scripts/verify-app-runtime.sh"
  fi
fi
rp_cb_phase_complete G.app_runtime

# --- H.observability (light) ---
if [[ "${COLD_BOOTSTRAP_SKIP_OBSERVABILITY_ARTIFACTS:-0}" != "1" ]] && [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ -x "$SCRIPT_DIR/ensure-observability-stack-ready.sh" ]]; then
  rp_cb_phase_enter H.observability "ensure observability stack"
  rp_cb_run bash "$SCRIPT_DIR/ensure-observability-stack-ready.sh" || echo "⚠️  observability stack not ready (non-fatal before hosts gate)"
  rp_cb_phase_complete H.observability
fi

# --- I.transport (hosts gate, no edge smoke) ---
rp_cb_phase_enter I.transport "Caddy MetalLB IP + /etc/hosts gate (no edge smoke yet)"
export VERIFY_BOOTSTRAP_HTTP3_EDGE=0
rp_cb_ensure_kube_api "before I.transport / Caddy MetalLB wait" || \
  rp_cb_phase_fail I.transport "kube API bridge align failed" "re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap"
rp_cb_run bash "$SCRIPT_DIR/wait-caddy-metallb-ip.sh" || rp_cb_phase_fail I.transport "caddy-h3 MetalLB IP missing" "kubectl -n ingress-nginx get svc caddy-h3"
if [[ "$RP_CB_DRY_RUN" != "1" ]]; then
  python3 -c "
import json, time
from pathlib import Path
p = Path('$RP_CB_PROGRESS')
prog = json.loads(p.read_text()) if p.is_file() else {'completed':[],'events':[]}
prog.setdefault('hosts_gate', {})
prog['hosts_gate'] = {
  'hostname': '${RP_PUBLIC_HOST}',
  'paused': True,
  'edge_smoke': 'deferred',
  'next': 'make rp-preflight-network-contract',
  'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
}
p.write_text(json.dumps(prog, indent=2)+'\n')
"
fi
rp_cb_phase_complete I.transport

if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  echo "[dry-run] J.final_contract → make cold-bootstrap-post-hosts (after hosts)"
  gate_ok "cold-bootstrap-plan" "dry-run complete (no Colima/hosts mutations)"
  exit 0
fi

# J.final_contract — single finished cold-bootstrap report (or explicit incomplete exit)
if [[ "${HOSTS_AUTO:-0}" == "1" ]]; then
  rp_cb_ok "HOSTS_AUTO=1 — align /etc/hosts and run J.final_contract"
  chmod +x "$SCRIPT_DIR/bootstrap/align-hosts.sh" 2>/dev/null || true
  HOSTS_AUTO=1 bash "$SCRIPT_DIR/bootstrap/align-hosts.sh" || \
    rp_cb_phase_fail I.transport "align-hosts failed" "HOSTS_AUTO=1 bash scripts/bootstrap/align-hosts.sh"
  exec bash "$SCRIPT_DIR/cold-bootstrap-post-hosts.sh"
fi

if [[ "${RP_PAUSE_FOR_HOSTS:-1}" == "0" ]]; then
  rp_cb_ok "RP_PAUSE_FOR_HOSTS=0 — continuing to J.final_contract without pause"
  exec bash "$SCRIPT_DIR/cold-bootstrap-post-hosts.sh"
fi

node "$SCRIPT_DIR/render-bootstrap-dag-html.mjs" --html-out "$RP_CB_BENCH/bootstrap_dag.html" 2>/dev/null || true
rp_cb_write_wall_timing
printf '\n'
printf 'ℹ️  A–I complete. This is an intentional pause before browser/host edge proof (J.final_contract).\n'
printf '   Update /etc/hosts so %s maps to the Caddy MetalLB IP above, then run:\n' "$RP_PUBLIC_HOST"
printf '   COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap-post-hosts\n'
printf '   Or one shot: HOSTS_AUTO=1 COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap\n'
printf '   Full log: %s\n' "${RP_COLD_BOOTSTRAP_LOG:-$RP_CB_BENCH/cold-bootstrap.full.log}"
exit 2
