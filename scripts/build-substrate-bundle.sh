#!/usr/bin/env bash
# Build a portable substrate bundle (tarball) for a **separate project in a different repo**.
# This is an extra copy of the substrate + services layout — extract in the other repo, not in record-platform.
# Includes: Caddyfile, Caddy/Envoy/MetalLB manifests, TLS/rotation scripts, proto, root workspace files
# (package.json, pnpm-workspace.yaml, tsconfig.base.json), services (common, api-gateway, auth-service
# ported; listings, booking, messaging, notification, trust, analytics skeletons), docs/ARCHITECTURE.md
# and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md for housing-platform global-scale spec.
#
# Usage:
#   ./scripts/build-substrate-bundle.sh [output-dir] [project-name]
#   ./scripts/build-substrate-bundle.sh                    # -> substrate-bundle/
#   ./scripts/build-substrate-bundle.sh substrate-bundle housing   # -> substrate-bundle-housing/ (for housing repo)
#   BUNDLE_OUTPUT_ROOT=/Users/tom BUNDLE_FOLDER_NAME=Housing-Legacy-Export ./scripts/build-substrate-bundle.sh
#   # -> /Users/tom/Housing-Legacy-Export/ and /Users/tom/Housing-Legacy-Export.tar.gz
# Root docs: README.md (housing-specific), ENGINEERING.md and Runbook.md (cluster-only focus). See docs/SUBSTRATE_OPERATIONS_REPORT.md §0.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BUNDLE_DIR="${1:-substrate-bundle}"
PROJECT_NAME="${2:-}"
# Optional: create bundle at a root path with a fixed folder name (e.g. /Users/tom/Housing-Legacy-Export).
#   BUNDLE_OUTPUT_ROOT=/Users/tom BUNDLE_FOLDER_NAME=Housing-Legacy-Export ./scripts/build-substrate-bundle.sh
# If both are set, BUNDLE_ABS = $BUNDLE_OUTPUT_ROOT/$BUNDLE_FOLDER_NAME; otherwise bundle is under repo root.
if [[ -n "${BUNDLE_OUTPUT_ROOT:-}" ]] && [[ -n "${BUNDLE_FOLDER_NAME:-}" ]]; then
  BUNDLE_ABS="${BUNDLE_OUTPUT_ROOT%/}/${BUNDLE_FOLDER_NAME}"
  mkdir -p "$BUNDLE_ABS"
  BUNDLE_ABS="$(cd "$BUNDLE_ABS" && pwd)"
else
  if [[ -n "$PROJECT_NAME" ]]; then
    BASE="${BUNDLE_DIR%-*}"
    [[ "$BASE" == "$BUNDLE_DIR" ]] && BASE="$BUNDLE_DIR"
    BUNDLE_DIR="${BASE}-${PROJECT_NAME}"
  fi
  BUNDLE_ABS="$(cd "$REPO_ROOT" && mkdir -p "$BUNDLE_DIR" && cd "$BUNDLE_DIR" && pwd)"
fi
rm -rf "$BUNDLE_ABS"
mkdir -p "$BUNDLE_ABS"

echo "Building substrate bundle in $BUNDLE_ABS (for separate project/repo) ..."

# Root: Caddyfile, docker-compose, workspace config (housing-platform spec)
cp Caddyfile "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f docker-compose.yml ]] && cp docker-compose.yml "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f package.json ]] && cp package.json "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f pnpm-workspace.yaml ]] && cp pnpm-workspace.yaml "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f pnpm-lock.yaml ]] && cp pnpm-lock.yaml "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f tsconfig.base.json ]] && cp tsconfig.base.json "$BUNDLE_ABS/" 2>/dev/null || true
[[ -f .npmrc ]] && cp .npmrc "$BUNDLE_ABS/" 2>/dev/null || true

# Root docs: README (housing-specific), ENGINEERING.md and Runbook.md (cluster-only focused).
# README: use housing-project README (architecture, user cases, service breakdown); no RP-specific breakthroughs.
if [[ -f docs/housing-platform/README.md ]]; then
  cp docs/housing-platform/README.md "$BUNDLE_ABS/README.md"
else
  # Fallback: minimal project README pointing at docs
  echo "# Housing legacy substrate export" > "$BUNDLE_ABS/README.md"
  echo "Substrate + 7 domain services. See docs/ARCHITECTURE.md and docs/SUBSTRATE_BUNDLE_OPERATIONS.md." >> "$BUNDLE_ABS/README.md"
fi
# ENGINEERING.md and Runbook.md: same as RP but cluster-only focused (Kubernetes, Caddy, Envoy, MetalLB, TLS, runbook issues).
_cluster_note="**Cluster-only focus:** This copy is for Kubernetes cluster operations, TLS/mTLS, Caddy/Envoy, MetalLB, and runbook issues. Application/product specifics are in README.md."
if [[ -f ENGINEERING.md ]]; then
  { echo "$_cluster_note"; echo ""; cat ENGINEERING.md; } > "$BUNDLE_ABS/ENGINEERING.md"
fi
if [[ -f docs/Runbook.md ]]; then
  { echo "$_cluster_note"; echo ""; cat docs/Runbook.md; } > "$BUNDLE_ABS/Runbook.md"
fi

# infra/ — copy full infra except db and ansible; include haproxy, kafka, nginx, k8s (and docs)
# Excluded: infra/db (per-project), infra/ansible (RP-specific)
mkdir -p "$BUNDLE_ABS/infra"
[[ -d infra/docs ]] && cp -R infra/docs "$BUNDLE_ABS/infra/" 2>/dev/null || true
[[ -d infra/haproxy ]] && cp -R infra/haproxy "$BUNDLE_ABS/infra/" 2>/dev/null || true
[[ -d infra/kafka ]] && cp -R infra/kafka "$BUNDLE_ABS/infra/" 2>/dev/null || true
[[ -d infra/nginx ]] && cp -R infra/nginx "$BUNDLE_ABS/infra/" 2>/dev/null || true
# k8s: top-level YAML (Caddy, etc.), metallb, overlays; base = substrate only (no RP app services)
mkdir -p "$BUNDLE_ABS/infra/k8s"
for f in infra/k8s/*.yaml; do [[ -f "$f" ]] && cp "$f" "$BUNDLE_ABS/infra/k8s/"; done
[[ -d infra/k8s/metallb ]] && cp -R infra/k8s/metallb "$BUNDLE_ABS/infra/k8s/" 2>/dev/null || true
[[ -d infra/k8s/overlays ]] && cp -R infra/k8s/overlays "$BUNDLE_ABS/infra/k8s/" 2>/dev/null || true
# base/: substrate only — namespaces, config, kafka-external, kafka, envoy-test, redis, haproxy, nginx, observability, monitoring, exporters
# RP-only folders (api-gateway, auth-service, records-service, listings-service, etc.) are NOT copied; housing adds them later.
mkdir -p "$BUNDLE_ABS/infra/k8s/base"
[[ -f infra/k8s/base/namespaces.yaml ]] && cp infra/k8s/base/namespaces.yaml "$BUNDLE_ABS/infra/k8s/base/"
for dir in config kafka-external kafka envoy-test redis haproxy nginx observability monitoring exporters; do
  [[ -d "infra/k8s/base/$dir" ]] && cp -R "infra/k8s/base/$dir" "$BUNDLE_ABS/infra/k8s/base/"
done
# Base README: substrate only; app services added by project
echo 'Base contains substrate only (namespaces, config, kafka-external, kafka, envoy-test, redis, haproxy, nginx, observability, monitoring, exporters). Add one directory per app service (e.g. api-gateway, auth-service, listings-service) with deploy.yaml and service.yaml, then add the resource name to kustomization.yaml. Replace record-platform namespace with your app namespace.' > "$BUNDLE_ABS/infra/k8s/base/README.md"
# Base kustomization: substrate only; add your app services (api-gateway, auth-service, listings-service, ...) and list them here
cat > "$BUNDLE_ABS/infra/k8s/base/kustomization.yaml" << 'KUSTEOF'
# Substrate only. Add your app services (e.g. api-gateway, auth-service, listings-service) under base/ and append to resources.
# Replace record-platform namespace with your app namespace in all manifests.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespaces.yaml
  - config
  - kafka-external
  - kafka
  - envoy-test
  - redis
  - haproxy
  - nginx
  - observability
  - monitoring
  - exporters
KUSTEOF
# HPA example (template; add HPAs per service as you add deployments)
mkdir -p "$BUNDLE_ABS/infra/k8s/overlays/dev"
[[ -f infra/k8s/overlays/dev/hpa-api-gateway.yaml ]] && cp infra/k8s/overlays/dev/hpa-api-gateway.yaml "$BUNDLE_ABS/infra/k8s/overlays/dev/" 2>/dev/null || true
# Overlay kustomization: substrate base + HPA example; add patches/HPAs when you add services
cat > "$BUNDLE_ABS/infra/k8s/overlays/dev/kustomization.yaml" << 'OVLEOF'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
  - hpa-api-gateway.yaml
OVLEOF

# Proto (all .proto for gRPC; replace with housing-specific as needed)
mkdir -p "$BUNDLE_ABS/proto"
for p in proto/*.proto; do
  [[ -f "$p" ]] && cp "$p" "$BUNDLE_ABS/proto/" 2>/dev/null || true
done

# Scripts: every script needed for run-preflight-scale-and-all-suites.sh and run-all-test-suites.sh (no omissions).
# Sourced/invoked by preflight: lib/*, capture-control-plane-telemetry, colima-*, preflight-*, ensure-*, trim-*, clean-unused-kubeconfig,
# install-metallb*, verify-*, reissue-ca-and-leaf-load-all-services, kafka-ssl-from-dev-root, diagnose-reset-by-peer, k3d-registry-push-and-patch,
# reset-caddy-h3-to-default-image, patch-kafka-external-host, check-all-pods-and-tls, aggressive-cleanup-replicasets, force-deployments-to-working-replicasets,
# ensure-kafka-ready, wait-for-all-services-ready, build-k6-http3, ensure-tcpdump-in-capture-pods, ensure-shopping-*, run-all-test-suites, run-transport-study-experiments,
# run-k6-in-cluster, colima-quic-sysctl, verify-caddy-http3-in-cluster, run_pgbench_sweep.
# Invoked by run-all-test-suites: optimize-k3s-kine-database, verify-db-cache-quick, quick-pod-diagnostics, deep-dive-pod-diagnostics, setup-lb-ip-host-access,
# ensure-readiness-before-suites, test-auth-service, test-microservices-http2-http3*, enhanced-adversarial-tests, rotation-suite, test-packet-capture-standalone,
# test-tls-mtls-comprehensive, test-messaging-service-comprehensive, test-lb-coordinated, verify-db-and-cache-comprehensive.
mkdir -p "$BUNDLE_ABS/scripts"
_preflight_suites_scripts=(
  strict-tls-bootstrap.sh rollout-caddy.sh generate-envoy-client-cert.sh
  colima-apply-host-aliases.sh ensure-ready-for-preflight.sh ensure-k8s-api.sh
  get-pods-to-ready.sh install-metallb.sh verify-metallb-and-traffic-policy.sh
  setup-new-colima-cluster.sh
  rotation-suite.sh run-k6-chaos.sh compare-h2-h3-headers.sh kafka-ssl-from-dev-root.sh
  run-preflight-scale-and-all-suites.sh run-all-test-suites.sh
  test-microservices-http2-http3.sh test-microservices-http2-http3-enhanced.sh test-grpc-http2-http3.sh test-http2-http3-strict-tls.sh
  test-full-chain-with-rotation.sh smoke-services.sh
  backup-all-dbs.sh inspect-external-db-schemas.sh
  capture-control-plane-telemetry.sh colima-teardown-and-start.sh find-and-kill-idle-then-run-pipeline.sh colima-forward-6443.sh
  preflight-fix-kubeconfig.sh trim-completed-pods.sh clean-unused-kubeconfig.sh
  ensure-caddy-envoy-tcpdump.sh ensure-api-server-ready.sh preflight-phase0-freeze-check.sh
  install-metallb-colima.sh reissue-ca-and-leaf-load-all-services.sh
  verify-caddy-strict-tls-in-cluster.sh verify-caddy-strict-tls.sh ensure-strict-tls-mtls-preflight.sh
  diagnose-reset-by-peer.sh k3d-registry-push-and-patch.sh reset-caddy-h3-to-default-image.sh
  install-metallb-frr-bgp.sh verify-metallb-colima-l2-only.sh ensure-colima-metallb-for-l2.sh
  patch-kafka-external-host.sh ensure-all-services-tls.sh check-all-pods-and-tls.sh
  aggressive-cleanup-replicasets.sh force-deployments-to-working-replicasets.sh ensure-kafka-ready.sh wait-for-all-services-ready.sh
  build-k6-http3.sh ensure-tcpdump-in-capture-pods.sh ensure-shopping-order-number-sequence.sh ensure-shopping-returns-migration.sh
  run-transport-study-experiments.sh run-k6-in-cluster.sh colima-quic-sysctl.sh verify-caddy-http3-in-cluster.sh
  run_pgbench_sweep.sh
  optimize-k3s-kine-database.sh verify-db-cache-quick.sh quick-pod-diagnostics.sh deep-dive-pod-diagnostics.sh setup-lb-ip-host-access.sh
  ensure-readiness-before-suites.sh test-auth-service.sh enhanced-adversarial-tests.sh
  test-packet-capture-standalone.sh test-tls-mtls-comprehensive.sh test-messaging-service-comprehensive.sh test-lb-coordinated.sh
  verify-db-and-cache-comprehensive.sh
)
for f in "${_preflight_suites_scripts[@]}"; do
  [[ -f "scripts/$f" ]] && cp "scripts/$f" "$BUNDLE_ABS/scripts/"
done
[[ -f scripts/k6-chaos-test.js ]] && cp scripts/k6-chaos-test.js "$BUNDLE_ABS/scripts/" 2>/dev/null || true
# k6 load scripts: HTTP/2 + xk6 HTTP/3 (strict TLS via K6_CA_ABSOLUTE; Colima skips host HTTP/3 in run-k6-phases.sh)
[[ -d scripts/load ]] && mkdir -p "$BUNDLE_ABS/scripts/load" && for k6 in k6-chaos-test.js k6-http3-complete.js k6-reads.js k6-limit-test-comprehensive.js k6-find-max-rps-http3.js k6-http3-toolchain.js; do [[ -f "scripts/load/$k6" ]] && cp "scripts/load/$k6" "$BUNDLE_ABS/scripts/load/"; done 2>/dev/null || true
[[ -f scripts/load/run-k6-phases.sh ]] && cp scripts/load/run-k6-phases.sh "$BUNDLE_ABS/scripts/load/" 2>/dev/null || true
# Lib: kubectl-helper, http3, ensure-kubectl-shim, resolve-lb-ip, trust-dev-root-ca-macos (sourced by preflight/run-all-test-suites)
[[ -d scripts/lib ]] && cp -R scripts/lib "$BUNDLE_ABS/scripts/" 2>/dev/null || true
# Shims (PATH in preflight: scripts/shims) so kubectl/curl resolve correctly
[[ -d scripts/shims ]] && cp -R scripts/shims "$BUNDLE_ABS/scripts/" 2>/dev/null || true

# Docs (substrate + housing-platform global-scale spec)
mkdir -p "$BUNDLE_ABS/docs"
cp docs/SUBSTRATE_OPERATIONS_REPORT.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
cp docs/SUBSTRATE_BUNDLE_OPERATIONS.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/housing-platform/ARCHITECTURE.md ]] && cp docs/housing-platform/ARCHITECTURE.md "$BUNDLE_ABS/docs/ARCHITECTURE.md" 2>/dev/null || true
[[ -f docs/housing-platform/CURSOR_SCAFFOLD_INSTRUCTIONS.md ]] && cp docs/housing-platform/CURSOR_SCAFFOLD_INSTRUCTIONS.md "$BUNDLE_ABS/docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md" 2>/dev/null || true
[[ -f docs/NEW_CLUSTER_SETUP.md ]] && cp docs/NEW_CLUSTER_SETUP.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f infra/docs/METALLB.md ]] && cp infra/docs/METALLB.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/STRICT_TLS_MTLS_AND_KAFKA.md ]] && cp docs/STRICT_TLS_MTLS_AND_KAFKA.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/KAFKA_CURRENT_AND_ROADMAP.md ]] && cp docs/KAFKA_CURRENT_AND_ROADMAP.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f scripts/RUN-PREFLIGHT.md ]] && cp scripts/RUN-PREFLIGHT.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/XK6_HTTP3_SETUP.md ]] && cp docs/XK6_HTTP3_SETUP.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/VERIFY_VS_PREFLIGHT_HTTP3.md ]] && cp docs/VERIFY_VS_PREFLIGHT_HTTP3.md "$BUNDLE_ABS/docs/" 2>/dev/null || true
[[ -f docs/housing-platform/KAFKA_SUBSTRATE.md ]] && cp docs/housing-platform/KAFKA_SUBSTRATE.md "$BUNDLE_ABS/docs/KAFKA_SUBSTRATE.md" 2>/dev/null || true
[[ -f docs/housing-platform/REPO_SETUP_SPEC.md ]] && cp docs/housing-platform/REPO_SETUP_SPEC.md "$BUNDLE_ABS/docs/REPO_SETUP_SPEC.md" 2>/dev/null || true
[[ -f docs/housing-platform/PORTS_REFERENCE.md ]] && cp docs/housing-platform/PORTS_REFERENCE.md "$BUNDLE_ABS/docs/PORTS_REFERENCE.md" 2>/dev/null || true

# Services: common, api-gateway, auth-service (ported), cron-jobs + webapp + 6 housing skeletons (7 domain services per ARCHITECTURE.md)
mkdir -p "$BUNDLE_ABS/services"
[[ -d services/common ]] && cp -R services/common "$BUNDLE_ABS/services/" 2>/dev/null || true
[[ -d services/api-gateway ]] && cp -R services/api-gateway "$BUNDLE_ABS/services/" 2>/dev/null || true
[[ -d services/auth-service ]] && cp -R services/auth-service "$BUNDLE_ABS/services/" 2>/dev/null || true
[[ -d services/cron-jobs ]] && cp -R services/cron-jobs "$BUNDLE_ABS/services/" 2>/dev/null || true
[[ -d webapp ]] && cp -R webapp "$BUNDLE_ABS/" 2>/dev/null || true

# Auth DB dump (5437-auth.dump) for auth-service restore — include if backup dir exists
AUTH_DUMP=""
for d in backups/all-8-20260312-091418 backups/all-8-*; do
  [[ -f "$d/5437-auth.dump" ]] && AUTH_DUMP="$d/5437-auth.dump" && break
done
mkdir -p "$BUNDLE_ABS/backups"
if [[ -n "$AUTH_DUMP" ]] && [[ -f "$AUTH_DUMP" ]]; then
  cp "$AUTH_DUMP" "$BUNDLE_ABS/backups/5437-auth.dump" 2>/dev/null || true
  echo "  Included auth dump: backups/5437-auth.dump"
fi
if [[ ! -f "$BUNDLE_ABS/backups/5437-auth.dump" ]]; then
  echo "# Place 5437-auth.dump here for auth-service DB restore (e.g. from record-platform backups/all-8-YYYYMMDD-HHMMSS/5437-auth.dump). Restore: pg_restore -h HOST -p 5437 -U postgres -d auth --clean --if-exists backups/5437-auth.dump" > "$BUNDLE_ABS/backups/README.txt"
fi

# 6 platform-plane skeletons (7 domain services total: auth ported + these). Per docs/ARCHITECTURE.md.
for svc in listings-service reservation-mesh messaging-service notification-service trust-service analytics-service; do
  mkdir -p "$BUNDLE_ABS/services/$svc"
  echo "# $svc" > "$BUNDLE_ABS/services/$svc/README.md"
  echo "" >> "$BUNDLE_ABS/services/$svc/README.md"
  case "$svc" in
    listings-service)   echo "Owns: listings, geolocation, pricing, availability, search index, filtering, image metadata. DB: listings. No booking logic. Emit Kafka on listing changes." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
    reservation-mesh)   echo "Owns: reservation state machine, booking lifecycle, cancellation, landlord approval. DB: bookings. Emit: booking_created, booking_confirmed, booking_cancelled." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
    messaging-service) echo "Owns: conversations, messages, read receipts, attachment refs. DB: messaging. No booking/listing logic." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
    notification-service) echo "Consumes Kafka only. Email/push, rent reminders, price drop alerts. Stateless preferred." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
    trust-service)     echo "Owns: reviews, ratings aggregation, report abuse, moderation, listing flag state. DB: trust. Emit: user_suspended, listing_flagged." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
    analytics-service) echo "Consumes Kafka only. Event aggregation, platform metrics, revenue tracking, usage insights. Never in request path." >> "$BUNDLE_ABS/services/$svc/README.md" ;;
  esac
  echo "" >> "$BUNDLE_ABS/services/$svc/README.md"
  echo "Use services/common (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), /health, /metrics, Prisma schema. See docs/ARCHITECTURE.md and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md." >> "$BUNDLE_ABS/services/$svc/README.md"
done

# Services README (7 domain services per housing-platform spec)
cat > "$BUNDLE_ABS/services/README.md" << 'SVCEOF'
# Services (substrate + housing-platform 7 domain services)

## Substrate (shared)

- **common** — Kafka client (mTLS), Redis, Logger (Pino), Prometheus metrics, gRPC helpers, proto loader. No business logic. Use in every service.
- **api-gateway** — Auth middleware, rate limiting, gRPC proxy, REST entrypoint. No business logic.
- **cron-jobs** — Scheduled jobs (rent reminders, cleanup). Adapt for housing.
- **webapp/** (repo root) — Next.js reference. Adapt for housing UI.

## Ported

- **auth-service** — Users, roles (tenant, landlord, admin), JWT, MFA/passkeys. DB: auth. Restore from `backups/5437-auth.dump` (see backups/README.txt).

## Housing 7 domain services (skeletons → implement per ARCHITECTURE.md)

| # | Service | DB | Role |
|---|---------|-----|------|
| 1 | auth-service | auth | ✅ Ported |
| 2 | listings-service | listings | Listings, geo, pricing, search, filtering (skeleton) |
| 3 | reservation-mesh | bookings | Reservation lifecycle, Kafka: booking_created/confirmed/cancelled (skeleton) |
| 4 | messaging-service | messaging | Conversations, messages (skeleton) |
| 5 | notification-service | — | Kafka consumer only; stateless (skeleton) |
| 6 | trust-service | trust | Reviews, ratings, moderation, listing_flagged (skeleton) |
| 7 | analytics-service | — | Kafka consumer only; never in request path (skeleton) |

Event-driven: cross-domain only via Kafka. No cross-service DB access. Each service: own Prisma, /health, /metrics, Dockerfile (multi-stage, build common first). See docs/ARCHITECTURE.md and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md.
SVCEOF

# Placeholder certs dir (no secrets). Kafka mTLS: run scripts/kafka-ssl-from-dev-root.sh → certs/kafka-ssl/
mkdir -p "$BUNDLE_ABS/certs"
cat > "$BUNDLE_ABS/certs/README.txt" << 'CERTEOF'
# TLS certs (place or generate here)
# - dev-root.pem, dev-root.key (CA)
# - record.local.crt, record.local.key (leaf for ingress)
# - envoy-client.crt, envoy-client.key (Envoy mTLS to backends)
# Kafka mTLS: run scripts/kafka-ssl-from-dev-root.sh (after reissue). Output: certs/kafka-ssl/ (keystore, truststore, ca-cert.pem). Creates kafka-ssl-secret in cluster.
CERTEOF

# Mark bundle for separate repo (so consumers know this is an extra copy for another project)
echo "${PROJECT_NAME:-}" > "$BUNDLE_ABS/.substrate-project-name" 2>/dev/null || true

# README/ENGINEERING/Runbook already written at root above. Add bundle quick-start pointer if housing README exists.
if [[ -f docs/housing-platform/README.md ]]; then
  echo "" >> "$BUNDLE_ABS/README.md"
  echo "## Bundle quick start" >> "$BUNDLE_ABS/README.md"
  echo "Extract this tarball in your repo root. See **docs/SUBSTRATE_OPERATIONS_REPORT.md** and **docs/SUBSTRATE_BUNDLE_OPERATIONS.md** for cluster setup, TLS, and what to add." >> "$BUNDLE_ABS/README.md"
fi

# Tarball: one top-level folder (e.g. Housing-Legacy-Export). Create from parent of BUNDLE_ABS.
BUNDLE_PARENT="$(dirname "$BUNDLE_ABS")"
BUNDLE_TOP="$(basename "$BUNDLE_ABS")"
TARBALL="$BUNDLE_PARENT/${BUNDLE_TOP}.tar.gz"
(cd "$BUNDLE_PARENT" && tar -czvf "$TARBALL" "$BUNDLE_TOP")
echo "Created $TARBALL"
echo "Use in the other repo: extract there and merge contents (see README and docs/SUBSTRATE_BUNDLE_OPERATIONS.md)."
