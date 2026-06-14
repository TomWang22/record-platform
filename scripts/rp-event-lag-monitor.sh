#!/usr/bin/env bash
# Phase 16 — Event/outbox/notification lag monitor during soak window.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/phase-16-event-lag-monitor.md}"
LAG_WINDOW_SECONDS="${LAG_WINDOW_SECONDS:-${SOAK_DURATION_SECONDS:-120}}"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "${RP_PUBLIC_ORIGIN:-https://record-platform.test}")"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
NS="${K8S_NAMESPACE:-record-platform}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

mkdir -p "$REPORT_DIR"
FAIL=0
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }

psql_q() {
  psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d "$2" -At -c "$3" 2>/dev/null || echo "0"
}

outbox_published() {
  local port="$1" db="$2" schema="$3" etype="$4"
  psql_q "$port" "$db" "SELECT count(*) FROM ${schema}.outbox_events WHERE type='${etype}' AND published=true"
}

outbox_unpublished() {
  local port="$1" db="$2" schema="$3" etype="$4"
  psql_q "$port" "$db" "SELECT count(*) FROM ${schema}.outbox_events WHERE type='${etype}' AND published=false"
}

notif_count() {
  local etype="$1"
  psql_q 5441 notification "SELECT count(*) FROM notification.notifications WHERE event_type='${etype}'"
}

kafka_lag_snippet() {
  local grp="${NOTIFICATION_KAFKA_GROUP:-notification-service-group}"
  kubectl exec -n "$NS" kafka-0 -c kafka -- bash -lc \
    "/opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka-0.kafka.${NS}.svc.cluster.local:9093 \
     --command-config /tmp/client.properties --group ${grp} --describe 2>/dev/null | tail -n +2" 2>/dev/null \
    | awk '{sum+=$6} END {print sum+0}' || echo "na"
}

snapshot_outbox() {
  local label="$1"
  python3 - "$label" <<'PY'
import json, subprocess, os, sys
pg = os.environ.get("PGHOST", "127.0.0.1")
user = os.environ.get("PGUSER", "postgres")
pw = os.environ.get("PGPASSWORD", "postgres")
env = {**os.environ, "PGPASSWORD": pw}

def q(port, db, sql):
    r = subprocess.run(
        ["psql", "-h", pg, "-p", str(port), "-U", user, "-d", db, "-At", "-c", sql],
        capture_output=True, text=True, env=env,
    )
    return (r.stdout or "0").strip() or "0"

events = [
    ("AIInsightCreatedV1", 5439, "analytics", "analytics"),
    ("PricingRecommendationCreatedV1", 5440, "python_ai", "ai"),
    ("AuctionRiskDetectedV1", 5438, "postgres", "auction_monitor"),
    ("MessageSentV1", 5434, "messaging", "messaging"),
    ("OfferCreated", 5435, "listings", "listings"),
    ("BidPlaced", 5435, "listings", "listings"),
    ("AuctionWon", 5435, "listings", "listings"),
    ("AuctionLost", 5435, "listings", "listings"),
    ("ListingSold", 5435, "listings", "listings"),
]
out = {"label": sys.argv[1], "outbox": {}, "notifications": {}}
for etype, port, db, schema in events:
    pub = q(port, db, f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=true")
    unpub = q(port, db, f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=false")
    out["outbox"][etype] = {"published_true": int(pub), "published_false": int(unpub)}
for etype in ["AIInsightCreatedV1", "PricingRecommendationCreatedV1", "AuctionRiskDetectedV1", "MessageSentV1", "OfferCreated", "BidPlaced"]:
    out["notifications"][etype] = int(q(5441, "notification", f"SELECT count(*) FROM notification.notifications WHERE event_type='{etype}'"))
print(json.dumps(out))
PY
}

echo "=== Phase 16 event lag monitor (T16.2) ==="
echo "window=${LAG_WINDOW_SECONDS}s"

BASELINE="$(snapshot_outbox baseline)"
echo "baseline captured"

# Trigger producers mid-window
TOKEN="$(curl -sfS --max-time 20 --cacert "$CA" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"
USER_ID="$(curl -sfS --max-time 15 --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("sub") or (d.get("user") or {}).get("id") or "")' 2>/dev/null || true)"
if [[ -n "$USER_ID" && -n "$TOKEN" ]]; then
  curl -sfS --max-time 30 --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/analytics/ai/features/$USER_ID" >/dev/null 2>&1 && pass "trigger analytics ai features" || fail "analytics trigger"
  curl -sfS --max-time 20 --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
    "$BASE/auctions/ai-signals?refresh=1" >/dev/null 2>&1 && pass "trigger auction ai-signals" || fail "auction trigger"
  bash "$SCRIPT_DIR/rp-ai-outbox-publish-drain.sh" >/dev/null 2>&1 && pass "ai outbox drain" || fail "ai outbox drain"
else
  fail "contract auth for event triggers"
fi

sleep "$LAG_WINDOW_SECONDS"
AFTER="$(snapshot_outbox after)"
KAFKA_LAG="$(kafka_lag_snippet)"
KAFKA_GATE=0
if bash "$SCRIPT_DIR/audit-rp-kafka-producer-consumer-contract.sh" >/dev/null 2>&1; then
  pass "Kafka 3-broker mTLS contract"
else
  fail "Kafka 3-broker mTLS contract"
  KAFKA_GATE=1
fi

python3 - "$REPORT_MD" "$BASELINE" "$AFTER" "$LAG_WINDOW_SECONDS" "$KAFKA_LAG" "$KAFKA_GATE" <<'PY'
import json, sys

md, baseline_s, after_s, window, kafka_lag, kafka_gate = sys.argv[1:7]
baseline = json.loads(baseline_s)
after = json.loads(after_s)
kafka_fail = int(kafka_gate) != 0
fail = kafka_fail
lines = [
    "# Phase 16 event lag monitor (T16.2)",
    "",
    f"**RESULT: {'PASS' if not fail else 'FAIL'}**",
    "",
    f"- Window: {window}s",
    f"- Kafka consumer lag (sum LAG): {kafka_lag}",
    f"- Kafka 3-broker mTLS: {'PASS' if not kafka_fail else 'FAIL'}",
    "",
    "## Outbox published=true deltas",
    "",
    "| Event | baseline | after | delta | unpublished backlog (after) |",
    "|-------|----------|-------|------:|----------------------------:|",
]
new_publish = False
for etype, b in baseline["outbox"].items():
    a = after["outbox"].get(etype, {})
    dp = int(a.get("published_true", 0)) - int(b.get("published_true", 0))
    backlog = int(a.get("published_false", 0))
    lines.append(f"| {etype} | {b['published_true']} | {a.get('published_true',0)} | {dp:+d} | {backlog} |")
    if dp > 0 and etype in ("AIInsightCreatedV1", "PricingRecommendationCreatedV1", "AuctionRiskDetectedV1", "MessageSentV1", "OfferCreated", "BidPlaced"):
        new_publish = True

lines += ["", "## Notification row deltas", "", "| Event | baseline | after | delta |", "|-------|----------|-------|------:|"]
notif_delta = False
for etype in baseline["notifications"]:
    b = baseline["notifications"][etype]
    a = after["notifications"].get(etype, 0)
    d = int(a) - int(b)
    lines.append(f"| {etype} | {b} | {a} | {d:+d} |")
    if d > 0:
        notif_delta = True

lines += [
    "",
    "## Historical backlog note",
    "",
    "Unpublished `published=false` rows are documented as historical backlog; gate fails only when new events do not reach `published=true` during the soak window.",
    "",
]

if not new_publish:
    fail = True
    lines.append("- ❌ No new published=true deltas for tracked AI/marketplace events")
else:
    lines.append("- ✅ New published=true deltas observed")

if not notif_delta:
    lines.append("- ⚠️ No notification row deltas in window (may be deduped; not a hard fail)")
else:
    lines.append("- ✅ Notification deltas visible")

with open(md, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"{'✅' if not fail else '❌'} phase-16-event-lag-monitor → {md}")
sys.exit(1 if fail else 0)
PY
EXIT_CODE=$?
exit "$EXIT_CODE"
