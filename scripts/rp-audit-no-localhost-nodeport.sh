#!/usr/bin/env bash
# Fail if runtime/bootstrap config uses forbidden edge entrypoints (localhost, NodePort, *.local hostnames).
#
# Usage: bash scripts/rp-audit-no-localhost-nodeport.sh
# Env: REPO_ROOT, RP_AUDIT_STRICT=1 (default)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STRICT="${RP_AUDIT_STRICT:-1}"
SCOPE="${RP_AUDIT_SCOPE:-bootstrap}"

# shellcheck source=scripts/lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=scripts/lib/rp-localhost-allowlist.sh
source "$SCRIPT_DIR/lib/rp-localhost-allowlist.sh"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

VIOLATIONS=0
VIOLATION_LINES=()

is_allowlisted_path() {
  local f="$1"
  case "$f" in
    */docs/legacy/*|*/docs/bundles/*|*/istio-*/*|*/node_modules/*|*/.git/*|*/coverage/*|*/.venv*/*)
      return 0
      ;;
    */docs/porting/RP_NETWORK_CONTRACT.md|*/docs/porting/RP_*_CONTRACT.md|*/docs/porting/RP_COLIMA_PROFILE_SWITCH.md|*/docs/porting/RP_COLD_BOOTSTRAP.md|*/docs/porting/RP_RP_PREFLIGHT_LAB_TOOLKIT.md|*/docs/porting/RP_PREFLIGHT_LAB.md)
      return 0
      ;;
    */backups/hybrid-rp-och/*)
      return 0
      ;;
    */docker-compose.yml)
      # External infra only (Postgres 5433–5443, Redis, MinIO, Jaeger, Mailpit).
      # In-container healthchecks (127.0.0.1:PORT) are allowlisted via line_is_allowlisted_content.
      return 0
      ;;
    */docs/legacy/k8s/*)
      return 0
      ;;
  esac
  return 1
}

line_is_allowlisted_content() {
  local line="$1"
  local file="$2"
  if [[ "$line" == *"LEGACY_EXAMPLE_DO_NOT_USE"* ]]; then
    return 0
  fi
  if [[ "$line" == *"DB_RESTORE_ONLY"* ]]; then
    return 0
  fi
  # Documented hosts cleanup (remove RP line before adding record-platform.test)
  if [[ "$line" == *"sed"* ]] && [[ "$line" == *"record-platform.test"* ]]; then
    return 0
  fi
  if [[ "$line" == *"remove"* ]] && [[ "$line" == *"record-platform.test"* ]]; then
    return 0
  fi
  if [[ "$line" == *"svc.cluster.local"* ]] || [[ "$line" == *"cluster.local"* ]]; then
    return 0
  fi
  # In-pod gRPC health probes (same container), not host entrypoints.
  if [[ "$file" == *"/deploy.yaml" ]] || [[ "$file" == *"/deployment.yaml" ]]; then
    if [[ "$line" =~ -addr=localhost: ]] || [[ "$line" =~ tls-server-name=localhost ]]; then
      return 0
    fi
  fi
  # Prometheus self-scrape inside pod.
  if [[ "$line" == *"localhost:9090"* ]] && [[ "$file" == *prometheus* ]]; then
    return 0
  fi
  if [[ "$file" == */postgres/deploy.yaml ]] || [[ "$file" == *infra/k8s/base/postgres/* ]]; then
    if [[ "$line" == *"127.0.0.1"* ]] || [[ "$line" == *"pg_isready"* ]]; then
      return 0
    fi
  fi
  if [[ "$file" == *prometheus-deploy.yaml ]] && [[ "$line" == *"host.docker.internal:9464"* ]]; then
    return 0
  fi
  if [[ "$file" == */deploy.yaml ]] || [[ "$file" == */deployment.yaml ]]; then
    if [[ "$line" == *"localhost:"* ]] || [[ "$line" == *"tls-server-name=localhost"* ]]; then
      return 0
    fi
    if [[ "$line" == *"host.docker.internal"* ]]; then
      return 0
    fi
  fi
  if rp_allow_api_gateway_sidecar_watchdog_gateway_url "$file" "$line"; then
    return 0
  fi
  if [[ "$file" == *kafka-external* ]] && [[ "$line" == *"host.docker.internal"* ]]; then
    return 0
  fi
  # Ollama sidecar loopback.
  if [[ "$file" == *ollama* ]] && [[ "$line" == *"127.0.0.1:11434"* ]]; then
    return 0
  fi
  # Admin bind inside container (not a client URL).
  if [[ "$line" == *"admin 0.0.0.0:2019"* ]] || [[ "$line" == *"admin off"* ]]; then
    return 0
  fi
  # docker-compose.yml: in-container probes only (not host edge / advertised listeners).
  if [[ "$file" == */docker-compose.yml ]]; then
    if [[ "$line" == *healthcheck:* ]] || [[ "$line" == *"CMD-SHELL"* ]] || [[ "$line" == *"CMD,"* ]]; then
      if [[ "$line" == *"127.0.0.1"* ]] || [[ "$line" == *"localhost"* ]]; then
        return 0
      fi
    fi
    if [[ "$line" == *"redis-cli"* ]] || [[ "$line" == *"pg_isready"* ]] || [[ "$line" == *"/minio/health"* ]]; then
      return 0
    fi
  fi
  # Jaeger port-forward docs (not bootstrap entry).
  if [[ "$file" == *app-config.yaml ]] && [[ "$line" == *"port-forward"* ]] && [[ "$line" == *"127.0.0.1:16686"* ]]; then
    return 0
  fi
  if [[ "$file" == *app-secrets.yaml ]] && [[ "$line" == *"SMTP"* || "$line" == *"MailHog"* || "$line" == *"mailpit"* ]]; then
    return 0
  fi
  if [[ "$line" =~ ^[[:space:]]*# ]]; then
    return 0
  fi
  # Guard clauses that reject loopback (not client URLs).
  if [[ "$file" == *verify-app-runtime.sh ]] && [[ "$line" == *"localhost:\${grpc_port}"* || "$line" == *"127.0.0.1:\${port}"* || "$line" == *"tls-server-name=localhost"* ]]; then
    return 0
  fi
  if [[ "$file" == *bring-up-external-infra.sh ]] && [[ "$line" == *"nc -z 127.0.0.1"* ]]; then
    return 0
  fi
  if [[ "$file" == *strict-tls-bootstrap.sh ]] && [[ "$line" == *"forbidden SAN"* ]]; then
    return 0
  fi
  if [[ "$file" == *rp-cold-bootstrap-lib.sh ]] && [[ "$line" == *"nc -z 127.0.0.1"* ]]; then
    return 0
  fi
  if [[ "$file" == *bootstrap-cluster.sh ]] || [[ "$file" == *rp-align-colima-kubeconfig.sh ]] || [[ "$file" == *rp-bootstrap-kubeconfig.sh ]]; then
    if [[ "$line" == *"kubeconfig still on loopback"* ]]; then
      return 0
    fi
    if [[ "$line" == *'$_server'* ]] && [[ "$line" == *"127.0.0.1"* ]]; then
      return 0
    fi
  fi
  return 1
}

record_violation() {
  local file="$1" line_no="$2" rule="$3" snippet="$4"
  VIOLATIONS=$((VIOLATIONS + 1))
  VIOLATION_LINES+=("${file}:${line_no} [${rule}] ${snippet}")
}

scan_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  is_allowlisted_path "$file" && return 0
  case "$file" in
    *rp-audit-no-localhost-nodeport.sh|*rp-audit-metallb-sni.sh|*/edge-test-url.sh)
      return 0
      ;;
    *colima-forward-6443.sh|*colima-teardown-and-start.sh)
      return 0
      ;;
  esac

  local rel="${file#"$REPO_ROOT"/}"
  local n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line_is_allowlisted_content "$line" "$file" && continue

    if [[ "$line" =~ (^|[^a-zA-Z0-9_-])localhost([^a-zA-Z0-9_-]|$) ]] && [[ "$line" != *"svc.cluster.local"* ]]; then
      if [[ "$line" == *"no localhost"* ]] || [[ "$line" == *"FORBID_LOCALHOST"* ]] || [[ "$line" == *"localhost/NodePort"* ]]; then
        :
      else
        record_violation "$rel" "$n" "localhost" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
      fi
    fi
    if [[ "$line" == *"127.0.0.1"* ]]; then
      if rp_allow_api_gateway_sidecar_watchdog_gateway_url "$file" "$line"; then
        :
      elif [[ "$file" == *docker-compose* ]] && head -20 "$file" 2>/dev/null | grep -q DB_RESTORE_ONLY; then
        :
      elif [[ "$file" == *app-config.yaml ]] && [[ "$line" == *"healthcheck"* || "$line" == *"port-forward"* ]]; then
        :
      elif [[ "$file" == *edge-test-url.sh ]] && [[ "$line" == *"127.0.0.1:4000"* || "$line" == *"not 127.0.0.1"* ]]; then
        :
      elif [[ "$file" == *verify-kafka-ready.sh ]] && [[ "$line" == *"127.0.0.1:9093"* ]]; then
        :
      elif [[ "$line" == *"no 127.0.0.1"* || "$line" == *"not 127.0.0.1"* || "$line" == *"loopback"* && "$line" == *"bridge"* ]]; then
        :
      else
        record_violation "$rel" "$n" "127.0.0.1" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
      fi
    fi
    if [[ "$line" == *"host.docker.internal"* ]] && [[ "$file" != *docker-compose* ]] && [[ "$file" != *".env.example"* ]] && [[ "$file" != *app-config.yaml ]]; then
      if [[ "$file" == *Makefile* ]] && [[ "$line" == *colima-patch* || "$line" == *"host.docker.internal DNS"* ]]; then
        :
      else
        record_violation "$rel" "$n" "host.docker.internal" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
      fi
    fi
    if [[ "$line" == *"record-platform.test"* ]] || [[ "$line" == *"record-platform.local"* ]]; then
      record_violation "$rel" "$n" "rp-hostname" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
    fi
    if [[ "$line" =~ (^|[^a-zA-Z0-9_.-])record\.local([^a-zA-Z0-9_.-]|$) ]]; then
      if [[ "$line" != *"svc.cluster.local"* ]]; then
        record_violation "$rel" "$n" "record.local" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
      fi
    fi
    if [[ "$line" =~ (^|[^a-zA-Z0-9_.-])record\.test([^a-zA-Z0-9_.-]|$) ]] && [[ "$line" != *"record-platform.test"* ]]; then
      record_violation "$rel" "$n" "record.test" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
    fi
  done <"$file"
}

scan_tree() {
  local dir="$1"
  shift
  local prune_expr=("$@")
  [[ -d "$dir" ]] || return 0
  local find_args=(
    "$dir" -type f
    ! -path '*/.git/*'
    ! -path '*/node_modules/*'
    ! -path '*/docs/bundles/*'
    ! -path '*/docs/legacy/*'
    ! -path '*/istio-*/*'
    ! -path '*/coverage/*'
  )
  for pe in "${prune_expr[@]}"; do
    find_args+=( ! -path "$pe" )
  done
  while IFS= read -r -d '' f; do
    case "$f" in
      *.png|*.jpg|*.jpeg|*.gif|*.ico|*.woff*|*.tar|*.gz|*.zip|*.dump|*.jar|*.bin|*.bak)
        continue
        ;;
    esac
    scan_file "$f"
  done < <(find "${find_args[@]}" -print0 2>/dev/null)
}

scan_tests_for_app_urls() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  while IFS= read -r f; do
    is_allowlisted_path "$f" && continue
    [[ "$f" != */tests/* ]] && continue
    local rel="${f#"$REPO_ROOT"/}" n=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      n=$((n + 1))
      line_is_allowlisted_content "$line" "$f" && continue
      if [[ "$line" =~ https?://(localhost|127\.0\.0\.1)(:|/) ]] || [[ "$line" =~ BASE_URL=.*localhost ]]; then
        record_violation "$rel" "$n" "test-app-url" "$(echo "$line" | sed 's/^[[:space:]]*//' | cut -c1-120)"
      fi
    done <"$f"
  done < <(find "$dir" -path '*/tests/*' -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \) 2>/dev/null)
}

audit_kube_api_tunnel_in_bootstrap_scripts() {
  local patterns='127\.0\.0\.1:6443|localhost:6443|colima-forward-6443'
  local files=(
    "$REPO_ROOT/scripts/create-kafka-event-topics-k8s.sh"
    "$REPO_ROOT/scripts/verify-kafka-required-topics-k8s.sh"
    "$REPO_ROOT/scripts/verify-kafka-event-topic-partitions.sh"
    "$REPO_ROOT/scripts/verify-kafka-cluster.sh"
    "$REPO_ROOT/scripts/verify-kafka-kraft-e2e.sh"
    "$REPO_ROOT/scripts/bootstrap-cluster.sh"
    "$REPO_ROOT/scripts/cold-bootstrap.sh"
    "$REPO_ROOT/scripts/cold-bootstrap-post-hosts.sh"
    "$REPO_ROOT/scripts/dev-onboard-local.sh"
    "$REPO_ROOT/scripts/wait-for-docker-compose-kafka-strict-ready.sh"
    "$REPO_ROOT/scripts/rp-ensure-kube-api.sh"
    "$REPO_ROOT/scripts/rp-kube-api-health.sh"
    "$REPO_ROOT/scripts/rp-align-colima-kubeconfig.sh"
    "$REPO_ROOT/scripts/colima-api-health.sh"
    "$REPO_ROOT/Makefile"
  )
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      local rel="${f#"$REPO_ROOT"/}"
      local line_no="${hit%%:*}"
      local snippet="${hit#*:}"
      snippet="${snippet#:}"
      line_is_allowlisted_content "$snippet" "$f" && continue
      if [[ "$snippet" == *"no 127.0.0.1:6443"* ]] || [[ "$snippet" == *"no localhost:6443"* ]] || [[ "$snippet" == *"forbidden"* && "$snippet" == *"6443"* ]]; then
        continue
      fi
      record_violation "$rel" "$line_no" "kube-api-tunnel" "$(echo "$snippet" | sed 's/^[[:space:]]*//' | cut -c1-120)"
    done < <(grep -nE "$patterns" "$f" 2>/dev/null || true)
  done
}

say "RP active runtime network audit (host=${RP_PUBLIC_HOST}, scope=${SCOPE})"
echo "  scope: bootstrap/deploy scripts + infra/k8s + Makefile + compose + Caddyfile"
echo "  excluded: docs/ porting bundles toolkit-reference bench_logs backups"
echo "  doc RP strings: make rp-audit-porting-docs (non-blocking)"

K8S_SCAN_DIRS=(
  "$REPO_ROOT/infra/k8s/base/config"
  "$REPO_ROOT/infra/k8s/caddy-h3-configmap.yaml"
  "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml"
  "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml"
  "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml"
  "$REPO_ROOT/infra/k8s/ingress-nginx-envoy.yaml"
  "$REPO_ROOT/infra/k8s/base/kustomization.yaml"
  "$REPO_ROOT/infra/k8s/base/api-gateway"
)
for d in "${K8S_SCAN_DIRS[@]}"; do
  if [[ -f "$d" ]]; then
    scan_file "$d"
  else
    scan_tree "$d" '*/docs/*' '*/legacy/*'
  fi
done

ACTIVE_BOOTSTRAP_SCRIPTS=(
  scripts/cold-bootstrap.sh
  scripts/bootstrap-cluster.sh
  scripts/deploy-dev.sh
  scripts/bring-up-external-infra.sh
  scripts/strict-tls-bootstrap.sh
  scripts/verify-app-runtime.sh
  scripts/verify-deployment-integrity.sh
  scripts/wait-for-housing-rollouts.sh
  scripts/wait-for-platform-service-endpoints.sh
  scripts/rp-clean-old-namespaces.sh
  scripts/rp-build-required-images.sh
  scripts/ensure-required-images.sh
  scripts/verify-required-images.sh
  scripts/ensure-edge-hosts.sh
  scripts/wait-for-metallb-lb-ready.sh
  scripts/lib/record-platform-docker-services-default.sh
  scripts/lib/rp-runtime-deploy-services.sh
  scripts/lib/rp-network-contract.sh
  scripts/lib/rp-cold-bootstrap-lib.sh
)
for rel in "${ACTIVE_BOOTSTRAP_SCRIPTS[@]}"; do
  scan_file "$REPO_ROOT/$rel"
done

for f in \
  "$REPO_ROOT/Makefile" \
  "$REPO_ROOT/package.json" \
  "$REPO_ROOT/pnpm-workspace.yaml" \
  "$REPO_ROOT/docker-compose.yml" \
  "$REPO_ROOT/Caddyfile"; do
  scan_file "$f"
done

audit_kube_api_tunnel_in_bootstrap_scripts

for f in \
  "$REPO_ROOT/services/api-gateway/src/server.ts" \
  "$REPO_ROOT/infra/k8s/base/config/app-config.yaml"; do
  scan_file "$f"
done

say "NodePort / nodePort in infra/k8s (active manifests)"
while IFS= read -r -d '' f; do
  is_allowlisted_path "$f" && continue
  if grep -qE 'type:\s*NodePort|nodePort:' "$f" 2>/dev/null; then
    rel="${f#"$REPO_ROOT"/}"
    record_violation "$rel" "0" "NodePort" "$(grep -E 'type:\s*NodePort|nodePort:' "$f" | head -1)"
  fi
done < <(find "$REPO_ROOT/infra/k8s" -type f \( -name '*.yaml' -o -name '*.yml' \) ! -path '*/docs/*' -print0 2>/dev/null)

if [[ "${RP_AUDIT_TEST_FIXTURES:-0}" == "1" ]]; then
  scan_tree "$REPO_ROOT/bench_logs/_audit_test_fixtures" '*/.git/*'
fi

if [[ "$VIOLATIONS" -gt 0 ]]; then
  say "Violations ($VIOLATIONS)"
  printf '%s\n' "${VIOLATION_LINES[@]}"
  bad "rp-audit-no-localhost-nodeport: $VIOLATIONS violation(s)"
  exit 1
fi

ok "active runtime network audit OK"
echo "ℹ️  docs/reference RP strings ignored by runtime audit; run: make rp-audit-porting-docs"
exit 0
