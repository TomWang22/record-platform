#!/usr/bin/env bash
# Verify record-platform-hybrid-cold-bootstrap-toolkit-*.tar.gz
# Usage: check-rp-hybrid-cold-bootstrap-toolkit.sh <archive.tar.gz>
set -euo pipefail

ARCHIVE="${1:-}"
[[ -f "$ARCHIVE" ]] || { echo "Usage: $0 <record-platform-hybrid-cold-bootstrap-toolkit-*.tar.gz>" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar -xzf "$ARCHIVE" -C "$STAGE"
ROOT="$STAGE/record-platform-hybrid-cold-bootstrap-toolkit"
[[ -d "$ROOT" ]] || { echo "❌ tarball root must be record-platform-hybrid-cold-bootstrap-toolkit/"; exit 1; }

FAIL=0
need() {
  if [[ -e "$ROOT/$1" ]]; then return 0; fi
  echo "❌ missing $1"
  FAIL=1
}
forbid() {
  if [[ ! -e "$ROOT/$1" ]]; then return 0; fi
  echo "❌ forbidden $1"
  FAIL=1
}

PATHS_FILE="$ROOT/scripts/lib/rp-hybrid-toolkit-bootstrap-paths.txt"
if [[ -f "$PATHS_FILE" ]]; then
  while IFS= read -r rel || [[ -n "$rel" ]]; do
    [[ -z "$rel" || "$rel" =~ ^# ]] && continue
    need "$rel"
  done <"$PATHS_FILE"
  need README_HYBRID_TOOLKIT.txt
else
  need STARTUP_FOR_OWNER_REVIEW.md
  need scripts/cold-bootstrap.sh
  need scripts/cold-bootstrap-post-hosts.sh
  need scripts/lib/rp-cold-bootstrap-lib.sh
  need scripts/rp-hard-reset.sh
  need scripts/rp-colima-start-clean.sh
  need scripts/colima-factory-reset.sh
  need scripts/bootstrap-cluster.sh
  need scripts/build-rp-hybrid-runtime-backup.sh
  need scripts/rp-align-colima-kubeconfig.sh
  need scripts/package-rp-hybrid-cold-bootstrap-toolkit-bundle.sh
  need scripts/cluster_health_dag.py
  need infra/bootstrap_invariants.graph.json
  need backups/hybrid-rp-och/validate-hybrid-backup.sh
  need docker-compose.yml
  need Makefile
fi

if ! grep -q 'F.cluster_deploy' "$ROOT/infra/bootstrap_invariants.graph.json" 2>/dev/null; then
  echo "❌ infra/bootstrap_invariants.graph.json missing F.cluster_deploy node"
  FAIL=1
fi
if ! grep -q 'rp_cb_run_bootstrap_cluster' "$ROOT/scripts/cold-bootstrap.sh" 2>/dev/null; then
  echo "❌ scripts/cold-bootstrap.sh missing rp_cb_run_bootstrap_cluster (quiet nested bootstrap)"
  FAIL=1
fi
if ! grep -q 'exit 2' "$ROOT/scripts/cold-bootstrap.sh" 2>/dev/null; then
  echo "❌ scripts/cold-bootstrap.sh should exit 2 INCOMPLETE at hosts gate"
  FAIL=1
fi
need scripts/lib/rp-cluster-dependency-dag.json

forbid docker-compose.external-rp.yml
forbid services/reservation-mesh
forbid services/messaging-service
forbid infra/k8s/base/reservation-mesh
forbid infra/k8s/base/messaging-service

for svc in messaging-service media-service trust-service notification-service; do
  need "services/$svc"
done

if grep -rq 'record-platform' "$ROOT/docker-compose.yml" 2>/dev/null; then
  echo "❌ docker-compose references record-platform"
  FAIL=1
fi
for k8s_f in k8s/ollama-gateway.yaml k8s/ollama-gateway-configmap.yaml k8s/ollama-worker.yaml k8s/ollama-worker-configmap.yaml; do
  need "$k8s_f"
done
if grep -rq 'record-platform' "$ROOT/k8s" 2>/dev/null; then
  echo "❌ k8s/ must use record-platform namespace (not record-platform)"
  FAIL=1
fi
# Legacy RP Kafka secret name must not appear in manifests (avoid literal in repo grep audits).
_legacy_och_kafka='och'"-"'kafka-ssl-secret'
if grep -rq "${_legacy_och_kafka}" "$ROOT/k8s" 2>/dev/null; then
  echo "❌ k8s/ must mount kafka-ssl-secret (not legacy RP kafka secret name)"
  FAIL=1
fi
for _bad in zookeeper 'cp-kafka' 'cp-zookeeper' auth-service api-gateway haproxy; do
  if grep -qE "^[[:space:]]*${_bad}:" "$ROOT/docker-compose.yml" 2>/dev/null; then
    echo "❌ docker-compose must not define service: $_bad"
    FAIL=1
  fi
done

MANIFEST="$ROOT/backups/hybrid-rp-och/materialized-rp-runtime/manifest.json"
if [[ -f "$MANIFEST" ]]; then
  python3 - "$MANIFEST" <<'PY' || { echo "❌ manifest port map"; FAIL=1; }
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
want = {
    "records": 5433, "messaging": 5434, "listings": 5435, "shopping": 5436,
    "auth": 5437, "postgres_core": 5438, "analytics": 5439, "python_ai": 5440,
    "notification": 5441, "trust": 5442, "media": 5443,
}
active = {a["service"]: a["target_port"] for a in d.get("assignments", []) if a.get("active")}
for s, p in want.items():
    if active.get(s) != p:
        print("bad", s, active.get(s), p); sys.exit(1)
for bad in ("bookings", "social"):
    if bad in active:
        print("forbidden active", bad); sys.exit(2)
print("manifest OK")
PY
else
  echo "❌ missing materialized manifest.json"
  FAIL=1
fi

for f in booking.proto social.proto; do
  if [[ -f "$ROOT/proto/events/$f" ]]; then
    echo "❌ proto/events/$f must not be in toolkit"
    FAIL=1
  fi
done

[[ "$FAIL" -eq 0 ]] && echo "✅ toolkit verification PASSED: $ARCHIVE" && exit 0
echo "❌ toolkit verification FAILED" >&2
exit 1
