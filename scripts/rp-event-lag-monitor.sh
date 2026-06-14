#!/usr/bin/env bash
# Phase 16 — Event/outbox/notification lag monitor (observe-only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/phase-16-event-lag-monitor.md}"
LAG_WINDOW_SECONDS="${LAG_WINDOW_SECONDS:-${SOAK_DURATION_SECONDS:-120}}"
BASE="https://record-platform.test"
CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-${METALLB_IP:-}}")"
[[ -f "$CA" ]] || { echo "❌ missing $CA"; exit 1; }
[[ "$LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "❌ no MetalLB IP for strict TLS"; exit 1; }
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

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

LAG_WINDOW_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export LAG_WINDOW_START_ISO

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
import json, os, subprocess, sys

pg = os.environ.get("PGHOST", "127.0.0.1")
user = os.environ.get("PGUSER", "postgres")
pw = os.environ.get("PGPASSWORD", "postgres")
window_start = os.environ.get("LAG_WINDOW_START_ISO", "")
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
tracked = {
    "AIInsightCreatedV1", "PricingRecommendationCreatedV1", "AuctionRiskDetectedV1",
    "MessageSentV1", "OfferCreated", "BidPlaced",
}
out = {"label": sys.argv[1], "window_start": window_start, "outbox": {}, "notifications": {}}
for etype, port, db, schema in events:
    pub = int(q(port, db, f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=true"))
    unpub = int(q(port, db, f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=false"))
    new_pub = 0
    new_unpub = 0
    if window_start:
        new_pub = int(q(port, db,
            f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=true AND created_at >= '{window_start}'"))
        new_unpub = int(q(port, db,
            f"SELECT count(*) FROM {schema}.outbox_events WHERE type='{etype}' AND published=false AND created_at >= '{window_start}'"))
    out["outbox"][etype] = {
        "published_true": pub,
        "published_false": unpub,
        "new_published_in_window": new_pub,
        "new_unpublished_in_window": new_unpub,
        "tracked": etype in tracked,
    }
for etype in ["AIInsightCreatedV1", "PricingRecommendationCreatedV1", "AuctionRiskDetectedV1", "MessageSentV1", "OfferCreated", "BidPlaced"]:
    out["notifications"][etype] = int(q(5441, "notification", f"SELECT count(*) FROM notification.notifications WHERE event_type='{etype}'"))
print(json.dumps(out))
PY
}

echo "=== Phase 16 event lag monitor (T16.2) ==="
echo "window=${LAG_WINDOW_SECONDS}s start=${LAG_WINDOW_START_ISO}"
echo "tls=strict cacert=certs/dev-chain.pem resolve=record-platform.test:443:${LB_IP}"

BASELINE="$(snapshot_outbox baseline)"
echo "baseline captured"

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"
USER_ID="$(curl -sfS "${CURL_TLS[@]}" --max-time 15 -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("sub") or (d.get("user") or {}).get("id") or "")' 2>/dev/null || true)"
if [[ -n "$USER_ID" && -n "$TOKEN" ]]; then
  curl -sfS "${CURL_TLS[@]}" --max-time 30 -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/analytics/ai/features/$USER_ID" >/dev/null 2>&1 && pass "trigger analytics ai features" || fail "analytics trigger"
  curl -sfS "${CURL_TLS[@]}" --max-time 20 -H "Authorization: Bearer $TOKEN" \
    "$BASE/auctions/ai-signals?refresh=1" >/dev/null 2>&1 && pass "trigger auction ai-signals" || fail "auction trigger"
  bash "$SCRIPT_DIR/rp-ai-outbox-publish-drain.sh" >/dev/null 2>&1 && pass "ai outbox drain" || fail "ai outbox drain"
else
  fail "contract auth for event triggers"
fi

sleep "$LAG_WINDOW_SECONDS"
bash "$SCRIPT_DIR/rp-ai-outbox-publish-drain.sh" >/dev/null 2>&1 && pass "final outbox drain (pre-snapshot)" || fail "final outbox drain"
sleep 5
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
tracked_types = {
    "AIInsightCreatedV1", "PricingRecommendationCreatedV1", "AuctionRiskDetectedV1",
    "MessageSentV1", "OfferCreated", "BidPlaced",
}

lines = [
    "# Phase 16 event lag monitor (T16.2)",
    "",
    f"**RESULT: {'PASS' if not fail else 'FAIL'}**",
    "",
    f"- Window: {window}s (start `{after.get('window_start', '')}`)",
    f"- Kafka consumer lag (sum LAG): {kafka_lag}",
    f"- Kafka 3-broker mTLS: {'PASS' if not kafka_fail else 'FAIL'}",
    "",
    "## Historical backlog (baseline unpublished)",
    "",
    "| Event | baseline unpublished |",
    "|-------|-------------------:|",
]
for etype, b in baseline["outbox"].items():
    lines.append(f"| {etype} | {b['published_false']} |")

lines += [
    "",
    "## New events during soak window",
    "",
    "| Event | new published | new unpublished (stuck) | published=true delta | unpublished backlog (after) |",
    "|-------|--------------:|------------------------:|---------------------:|----------------------------:|",
]
new_publish = False
new_stuck = []
backlog_pressure = []
for etype, b in baseline["outbox"].items():
    a = after["outbox"].get(etype, {})
    dp = int(a.get("published_true", 0)) - int(b.get("published_true", 0))
    du = int(a.get("published_false", 0)) - int(b.get("published_false", 0))
    new_pub = int(a.get("new_published_in_window", 0))
    new_unpub = int(a.get("new_unpublished_in_window", 0))
    backlog = int(a.get("published_false", 0))
    hist = int(b.get("published_false", 0))
    lines.append(
        f"| {etype} | {new_pub} | {new_unpub} | {dp:+d} | {backlog} |"
    )
    if dp > 0 and etype in tracked_types:
        new_publish = True
    if new_unpub > 0 and etype in tracked_types:
        if dp == 0 and new_pub == 0:
            new_stuck.append((etype, new_unpub))
        elif dp > 0:
            backlog_pressure.append((etype, new_unpub, hist, dp))

lines += ["", "## Notification row deltas", "", "| Event | baseline | after | delta |", "|-------|----------|-------|------:|"]
notif_delta = False
for etype in baseline["notifications"]:
    b = baseline["notifications"][etype]
    a = after["notifications"].get(etype, 0)
    d = int(a) - int(b)
    lines.append(f"| {etype} | {b} | {a} | {d:+d} |")
    if d > 0:
        notif_delta = True

lines += ["", "## Gate interpretation", ""]
if not new_publish:
    fail = True
    lines.append("- ❌ No new published=true deltas for tracked AI/marketplace events")
else:
    lines.append("- ✅ New published=true deltas observed")

if new_stuck:
    fail = True
    for etype, n in new_stuck:
        lines.append(f"- ❌ New unpublished with zero publish progress: {etype} ({n} stuck)")
else:
    lines.append("- ✅ No new unpublished events without publish progress")

for etype, n, hist, dp in backlog_pressure:
    lines.append(
        f"- ℹ️ Backlog pressure: {etype} has {n} window-created rows still unpublished "
        f"(historical backlog={hist}, published_delta={dp:+d}; FIFO drain behind backlog)"
    )

if not notif_delta:
    lines.append("- ⚠️ No notification row deltas in window (may be deduped; not a hard fail)")
else:
    lines.append("- ✅ Notification deltas visible")

lines.append("")
lines.append(
    "Historical backlog rows predate the soak window and are documented separately. "
    "Hard FAIL applies when new window rows remain unpublished **and** published=true delta is zero for that event type."
)

with open(md, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"{'✅' if not fail else '❌'} phase-16-event-lag-monitor → {md}")
sys.exit(1 if fail else 0)
PY
EXIT_CODE=$?
exit "$EXIT_CODE"
