#!/usr/bin/env bash
set -euo pipefail

# ---------- config ----------
KIND_CLUSTER="${KIND_CLUSTER:-h3}"
OVERLAY_DIR="infra/k8s/overlays/dev"
NS="record-platform"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service)
# ----------------------------

log()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*"; }

# 0) sanity: kind cluster present
if ! kind get clusters | grep -qx "$KIND_CLUSTER"; then
  err "kind cluster '$KIND_CLUSTER' not found."; exit 1
fi

# 1) detect node architecture -> build for the cluster node, not host default
log "Detecting cluster node architecture…"
KARCH="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || true)"
[[ -z "$KARCH" ]] && KARCH="$(uname -m)"
case "$KARCH" in
  aarch64|arm64) PLAT="linux/arm64" ;;
  x86_64|amd64)  PLAT="linux/amd64" ;;
  *)             PLAT="linux/arm64" ;;
esac
log "Building images for platform: $PLAT"

# 2) build local dev images
build_one () {
  local name="$1"
  local df="services/${name}/Dockerfile"
  local ctx="."
  # python AI uses its own context folder
  if [[ "$name" == "python-ai-service" ]]; then
    ctx="services/python-ai-service"
  fi
  if [[ -f "$df" ]]; then
    log "Building ${name}:dev"
    docker buildx build --platform="${PLAT}" -t "${name}:dev" -f "$df" "$ctx"
  else
    warn "Dockerfile missing: $df (skipping build)"
  fi
}

for name in "${SERVICES[@]}"; do build_one "$name"; done

# 3) load images into kind
log "Loading images into kind cluster '${KIND_CLUSTER}'…"
kind load docker-image "${SERVICES[@]/%/:dev}" --name "$KIND_CLUSTER"

# 4) apply overlay
log "Applying dev overlay: $OVERLAY_DIR"
kubectl apply -k "$OVERLAY_DIR"

# 5) optional: Prometheus Operator present?
if kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1; then
  log "ServiceMonitor CRD detected ✓"
else
  warn "No ServiceMonitor CRD. Install kube-prometheus-stack, or remove ../../base/monitoring from dev overlay."
fi

# 6) ensure hosts entry
log "Ensuring hosts entry for record.local"
if ! grep -q "record.local" /etc/hosts; then
  echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null
fi

# 7) bootstrap DB 'records' (and extensions) if missing
log "Bootstrapping database (create DB + extensions if needed)…"
POSTGRES_URL="$(kubectl -n "$NS" get cm app-config -o jsonpath='{.data.POSTGRES_URL}' 2>/dev/null || true)"
if [[ -z "${POSTGRES_URL:-}" ]]; then
  warn "POSTGRES_URL not found in app-config; skipping DB bootstrap."
else
  DB_EXISTS="$(
    kubectl -n "$NS" run dbcheck --image=postgres:16-alpine --restart=Never --rm -i --quiet --env="POSTGRES_URL=$POSTGRES_URL" -- \
      sh -lc '
        set -e
        BASE="${POSTGRES_URL%%\?*}"
        ADMIN="${BASE%/*}/postgres"
        psql "$ADMIN" -tAc "SELECT 1 FROM pg_database WHERE datname='\''records'\''" 2>/dev/null | tr -d "[:space:]"
      ' || echo ""
  )"
  if [[ "$DB_EXISTS" != "1" ]]; then
    log "Creating database 'records' and extensions (pgcrypto, citext, pg_trgm)…"
    kubectl -n "$NS" run dbinit --image=postgres:16-alpine --restart=Never --rm -i --env="POSTGRES_URL=$POSTGRES_URL" -- \
      sh -lc '
        set -e
        BASE="${POSTGRES_URL%%\?*}"
        ADMIN="${BASE%/*}/postgres"
        RECORDS="${BASE%/*}/records"
        psql "$ADMIN" -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname='\''records'\''" | grep -q 1 || psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE DATABASE records"
        psql "$RECORDS" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
        psql "$RECORDS" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS citext"
        psql "$RECORDS" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
      '
  else
    log "Database 'records' already exists ✓"
  fi
fi

# 8) re-run seed jobs (delete -> apply) to pick up baseline logic
log "Re-running seed jobs (baseline-on-P3005)…"
kubectl -n "$NS" delete job seed-auth seed-records --ignore-not-found
kubectl apply -f "${OVERLAY_DIR}/jobs"
# wait (best-effort) and show logs if something fails
if ! kubectl -n "$NS" wait --for=condition=complete --timeout=5m job/seed-auth job/seed-records; then
  warn "Seed jobs did not complete in time; showing logs:"
  kubectl -n "$NS" logs job/seed-auth --tail=200 || true
  kubectl -n "$NS" logs job/seed-records --tail=200 || true
fi

# 9) restart DB-using services to pick up migrations/env
log "Restarting DB-using services…"
kubectl -n "$NS" rollout restart deploy/auth-service deploy/records-service || true

# 10) wait for all core services
log "Waiting for deployments to roll out…"
for d in "${SERVICES[@]}"; do
  if kubectl -n "$NS" get deploy "$d" >/dev/null 2>&1; then
    kubectl -n "$NS" rollout status deploy/"$d" || true
  fi
done
# edge bits
for d in nginx; do
  if kubectl -n "$NS" get deploy "$d" >/dev/null 2>&1; then
    kubectl -n "$NS" rollout status deploy/"$d" || true
  fi
done

# 11) show images actually in use
log "Deployed container images:"
kubectl -n "$NS" get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"  →  "}{range .spec.template.spec.containers[*]}{.image}{" "}{end}{"\n"}{end}'

# 12) Prisma migration status (auth & records schemas)
log "Prisma migration rows per schema:"
kubectl -n "$NS" exec deploy/postgres -- \
  sh -lc "psql 'postgresql://postgres:postgres@localhost:5432/records' -Atc \"SET search_path TO auth; SELECT count(*) FROM _prisma_migrations;\" | awk '{print \"auth schema:\",\$1}'"
kubectl -n "$NS" exec deploy/postgres -- \
  sh -lc "psql 'postgresql://postgres:postgres@localhost:5432/records' -Atc \"SET search_path TO records; SELECT count(*) FROM _prisma_migrations;\" | awk '{print \"records schema:\",\$1}'"

# 13) quick edge/gateway probe (H2 + best-effort H3)
log "Probing through Caddy/Ingress"
CURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
if ! "$CURL" --version 2>/dev/null | grep -q 'HTTP3'; then CURL="$(command -v curl)"; fi
echo "H2 /_caddy/healthz : $("$CURL" -sS -I --http2 -H 'Host: record.local' https://record.local/_caddy/healthz | head -n1)"
echo "H2 /api/healthz     : $("$CURL" -sS -I --http2 -H 'Host: record.local' https://record.local/api/healthz | head -n1)"
for p in auth records listings analytics ai; do
  printf "/api/%s/healthz  : " "$p"
  $CURL -sS -I --http2 -H 'Host: record.local' "https://record.local/api/$p/healthz" | head -n1
done

log "Done."