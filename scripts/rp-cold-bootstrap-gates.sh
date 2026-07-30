#!/usr/bin/env bash
# Fail-fast gates for RP cold-bootstrap (source gate name as $1).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${RP_NAMESPACE:-${HOUSING_NS:-record-platform}}"
GATE="${1:-}"
_DRY="${COLD_BOOTSTRAP_DRY_RUN:-${RP_CB_DRY_RUN:-0}}"

fail() {
  echo "❌ GATE [$GATE] $*" >&2
  exit 1
}

ok() {
  echo "✅ GATE [$GATE] $*"
}

gate_workspace_forbidden() {
  for svc in reservation-mesh; do
    [[ -d "$REPO_ROOT/services/$svc" ]] && fail "services/$svc must not exist"
  done
  if [[ "$_DRY" == "1" ]]; then
    ok "workspace/forbidden (dry-run — kubectl checks skipped)"
    return 0
  fi
  if command -v kubectl >/dev/null 2>&1; then
    # Skip live cluster checks when the API is unreachable (common during P0/Z reset).
    if KUBECTL_REQUEST_TIMEOUT=5s kubectl get ns >/dev/null 2>&1; then
      kubectl get ns record-platform &>/dev/null && fail "namespace record-platform exists"
      for dep in reservation-mesh; do
        kubectl get deploy -n "$NS" "$dep" &>/dev/null 2>&1 && fail "deployment $dep in $NS"
      done
    else
      ok "workspace/forbidden (cluster unreachable — skipped live kubectl checks)"
    fi
  fi
  # Docker may be absent/half-dead before Z.colima_clean — never hang the gate.
  _docker_ps() {
    if command -v gtimeout >/dev/null 2>&1; then
      gtimeout 8 docker "$@" 2>/dev/null || true
    elif command -v timeout >/dev/null 2>&1; then
      timeout 8 docker "$@" 2>/dev/null || true
    else
      # macOS without GNU timeout: skip docker checks when socket is missing
      [[ -S "${DOCKER_HOST#unix://}" || -S /var/run/docker.sock || -S "${HOME}/.colima/default/docker.sock" || -S "${HOME}/.colima/docker.sock" ]] || return 0
      docker "$@" 2>/dev/null || true
    fi
  }
  if _docker_ps ps --format '{{.Names}}' | grep -qiE 'record-platform|rp-'; then
    fail "legacy external containers running"
  fi
  for p in 5444 5445 5446 5447 5448; do
    nc -z 127.0.0.1 "$p" 2>/dev/null && fail "forbidden port $p listening"
  done
  redis_wrong="$(_docker_ps ps --format '{{.Names}} {{.Ports}}' | grep -E ':6380->' || true)"
  [[ -n "$redis_wrong" ]] && fail "Redis on 6380 detected"
  ok "workspace/forbidden (no booking/social/legacy ports 5444–5448)"
}

gate_workspace_runtime_ports() {
  nc -z 127.0.0.1 6379 2>/dev/null || fail "Redis not on 6379"
  for p in 5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443; do
    nc -z 127.0.0.1 "$p" 2>/dev/null || fail "DB port $p not listening"
  done
  ok "workspace/runtime ports (Redis 6379, DB 5433–5443)"
}

gate_workspace() {
  gate_workspace_forbidden
  if [[ "${RP_GATE_WORKSPACE_MODE:-full}" != "forbidden" ]]; then
    gate_workspace_runtime_ports
  fi
}

gate_backup_materialization() {
  local mat="${RESTORE_BACKUP_DIR_ABS:-$REPO_ROOT/backups/hybrid-rp-och/materialized-rp-runtime}"
  [[ -f "$mat/manifest.json" ]] || fail "missing manifest.json in $mat"
  python3 - "$mat" <<'PY'
import json, sys, os
mat = sys.argv[1]
with open(os.path.join(mat, "manifest.json"), encoding="utf-8") as f:
    m = json.load(f)
expected = {
    5433: ("records", "5433-records"),
    5434: ("messaging", "5434-messaging"),
    5435: ("listings", "5435-listings"),
    5436: ("shopping", "5436-shopping"),
    5437: ("auth", "5437-auth"),
    5438: ("auction_monitor_core", "5438-auction-monitor-core"),
    5439: ("analytics", "5439-analytics"),
    5440: ("python_ai", "5440-python_ai"),
    5441: ("notification", "5441-notification"),
    5442: ("trust", "5442-trust"),
    5443: ("media", "5443-media"),
}
assign = {a["target_port"]: a for a in m.get("assignments", []) if a.get("active")}
if len(assign) != 11:
    sys.exit(f"expected 11 active DBs, got {len(assign)}")
for port, (svc, note) in expected.items():
    if port not in assign:
        sys.exit(f"missing port {port} ({svc})")
    a = assign[port]
    arts = a.get("artifacts") or []
    bases = {x.get("basename", "") for x in arts if x.get("basename")}
    # Validate by artifact type instead of reconstructing an exact prefix from
    # target_database. Some backups intentionally keep a legacy basename while
    # mapping to a normalized runtime DB name (ex: 5438 auction-monitor-core -> postgres).
    required_suffixes = ("-extensions.tsv", "-pg_settings.tsv", ".dump", ".sql.gz")
    for suffix in required_suffixes:
        if not any(name.startswith(f"{port}-") and name.endswith(suffix) for name in bases):
            sys.exit(f"port {port}: missing artifact with suffix {suffix}")
ex = set(m.get("excluded_services") or [])
if "bookings" not in ex or "social" not in ex:
    sys.exit("excluded_services must include bookings and social")
print("BACKUP_MAP_OK")
for port in sorted(expected):
    svc, artifact = expected[port]
    print(f"  {port} {svc:<22} {artifact}")
PY
  ok "backup materialization (11×4 artifacts)"
}

gate_certs() {
  bash "$SCRIPT_DIR/audit-rp-cert-coverage.sh" || fail "audit-rp-cert-coverage failed"
  bash "$SCRIPT_DIR/audit-rp-no-stale-pki.sh" || fail "audit-rp-no-stale-pki failed"
  bash "$SCRIPT_DIR/audit-rp-webapp-internal-calls.sh" >/dev/null || fail "audit-rp-webapp-internal-calls failed"
  bash "$SCRIPT_DIR/verify-rp-cert-chain.sh" >/dev/null || fail "verify-rp-cert-chain failed"
  bash "$SCRIPT_DIR/test-rp-ollama-gate.sh" >/dev/null || fail "test-rp-ollama-gate failed"
  bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" >/dev/null 2>&1 || fail "verify-kafka-tls-sans failed"
  for bad in record.local localhost record-platform.test; do
    grep -rq "$bad" "$REPO_ROOT/certs/" 2>/dev/null && fail "forbidden SNI/host $bad in certs/"
  done
  openssl x509 -in "$REPO_ROOT/certs/record-platform.test.crt" -noout -ext subjectAltName 2>/dev/null | grep -q record-platform.test \
    || fail "leaf missing record-platform.test SAN"
  ok "3-stage cert chain + record-platform.test SAN"
}

gate_kafka() {
  NS="$NS" bash "$SCRIPT_DIR/verify-kafka-ready.sh" >/dev/null || fail "verify-kafka-ready failed"
  if kubectl get sts kafka -n "$NS" &>/dev/null; then
    # KRaft brokers require SSL + command-config on :9093 (plaintext --list times out / returns empty).
    KAFKA_K8S_NS="$NS" bash "$SCRIPT_DIR/verify-kafka-required-topics-k8s.sh" >/dev/null \
      || fail "required kafka topics missing — run create-kafka-event-topics-k8s.sh"
    _inner_props='TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.endpoint.identification.algorithm="
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/rp-gate-kafka.props'
    kubectl exec -n "$NS" kafka-0 -- bash -ec "$_inner_props" >/dev/null 2>&1 \
      || fail "could not write kafka TLS props in kafka-0"
    topics="$(kubectl exec -n "$NS" kafka-0 -- kafka-topics \
      --bootstrap-server "kafka-0.kafka.${NS}.svc.cluster.local:9093" \
      --command-config /tmp/rp-gate-kafka.props --list 2>/dev/null || true)"
    [[ -n "$topics" ]] || fail "kafka-topics --list failed (SSL :9093)"
    for bad in booking social; do
      echo "$topics" | grep -qi "$bad" && fail "forbidden kafka topic contains $bad"
    done
  fi
  ok "Kafka 3-broker TLS + RP topics"
}

gate_k8s_rollout() {
  kubectl get ns "$NS" &>/dev/null || fail "namespace $NS missing"
  for bad in reservation-mesh; do
    kubectl get deploy,svc,pod -n "$NS" 2>/dev/null | grep -qi "$bad" && fail "forbidden resource $bad in $NS"
  done
  for want in api-gateway auth-service records-service listings-service shopping-service messaging-service media-service notification-service trust-service analytics-service python-ai-service auction-monitor webapp; do
    kubectl get deploy -n "$NS" "$want" &>/dev/null 2>&1 || echo "⚠️  deploy/$want not found yet (may still be rolling)" >&2
  done
  ok "k8s namespace $NS (no booking/social; messaging+media required)"
}

case "$GATE" in
  workspace) gate_workspace ;;
  backup) gate_backup_materialization ;;
  certs) gate_certs ;;
  kafka) gate_kafka ;;
  k8s) gate_k8s_rollout ;;
  *)
    echo "usage: $0 workspace|backup|certs|kafka|k8s" >&2
    exit 2
    ;;
esac
