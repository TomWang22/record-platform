#!/usr/bin/env bash
# Audit RP messaging/community port vs OCH reference expectations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/messaging-port-audit}"
mkdir -p "$OUT_DIR"

issues=()
warns=()
oks=()

add_issue() { issues+=("$1"); }
add_warn() { warns+=("$1"); }
add_ok() { oks+=("$1"); }

# --- required RP paths ---
for p in \
  services/messaging-service \
  services/messaging-service/prisma/schema.prisma \
  infra/k8s/base/messaging-service \
  webapp/app \
  proto/events/messaging.proto \
  ; do
  [[ -e "$p" ]] && add_ok "present: $p" || add_issue "missing: $p"
done

# --- stale social/booking on active paths ---
if grep -Rql 'social-service' infra/k8s/base infra/k8s/overlays/dev scripts/cold-bootstrap.sh scripts/deploy-dev.sh 2>/dev/null \
  | grep -v 'RP_SKIP_SOCIAL' | grep -v '#'; then
  add_warn "social-service references still in active k8s/bootstrap paths (review grep hits)"
fi
if grep -Rql 'booking-service\|bookings-service' infra/k8s/base scripts/cold-bootstrap.sh 2>/dev/null; then
  add_warn "booking-service references in infra/bootstrap (should be skipped)"
fi

# --- Prisma vs inspect contract ---
if [[ -f services/messaging-service/prisma/schema.prisma ]]; then
  grep -q 'outbox' services/messaging-service/prisma/schema.prisma \
    && add_ok "messaging Prisma mentions outbox" \
    || add_warn "messaging Prisma has no outbox model (check infra/db/02-messaging-outbox.sql)"
  grep -qi 'housing\|booking' services/messaging-service/prisma/schema.prisma \
    && add_issue "messaging Prisma contains housing/booking naming" \
    || add_ok "no housing/booking in messaging Prisma"
fi

# --- API gateway routes ---
if [[ -f services/api-gateway/src ]]; then
  gw="$(find services/api-gateway -name '*.ts' -o -name '*.js' 2>/dev/null | head -200)"
  echo "$gw" | xargs grep -l 'messaging\|/api/messages' 2>/dev/null | head -1 >/dev/null \
    && add_ok "api-gateway has messaging/messages routing" \
    || add_warn "api-gateway messaging routes not found via grep"
  echo "$gw" | xargs grep -l '/api/social' 2>/dev/null | head -1 >/dev/null \
    && add_warn "api-gateway still exposes /api/social" \
    || add_ok "no /api/social in api-gateway grep sample"
fi

# --- webapp ---
if grep -Rql '/api/social' webapp/app webapp/components 2>/dev/null; then
  add_warn "webapp still references /api/social"
else
  add_ok "webapp has no /api/social references"
fi
grep -Rql 'messages\|community\|messaging' webapp/app 2>/dev/null | head -1 >/dev/null \
  && add_ok "webapp messaging/community surface present" \
  || add_warn "webapp messaging UI grep inconclusive"

# --- Kafka events ---
if [[ -f proto/events/messaging.proto ]]; then
  add_ok "proto/events/messaging.proto exists"
else
  add_issue "missing proto/events/messaging.proto"
fi
if [[ -f scripts/lib/rp-kafka-event-topics-from-proto.sh ]]; then
  grep -q 'messaging' scripts/lib/rp-kafka-event-topics-from-proto.sh 2>/dev/null \
    && add_ok "kafka topic generator references messaging" \
    || add_warn "messaging topics not found in rp-kafka-event-topics-from-proto.sh"
fi

# --- k8s: messaging not social ---
if kubectl get deploy messaging-service -n record-platform >/dev/null 2>&1; then
  add_ok "cluster: messaging-service deployment exists"
else
  add_warn "cluster: messaging-service deployment not found (cluster may be down)"
fi
if kubectl get deploy social-service -n record-platform >/dev/null 2>&1; then
  add_issue "cluster: social-service deployment still present"
else
  add_ok "cluster: no social-service deployment"
fi

status="pass"
[[ ${#issues[@]} -gt 0 ]] && status="fail"

report_md="$OUT_DIR/report.md"
report_json="$OUT_DIR/report.json"

{
  echo "# RP messaging port audit"
  echo ""
  echo "Status: **$status**"
  echo ""
  echo "## Issues (${#issues[@]})"
  for i in "${issues[@]:-}"; do echo "- $i"; done
  echo ""
  echo "## Warnings (${#warns[@]})"
  for w in "${warns[@]:-}"; do echo "- $w"; done
  echo ""
  echo "## OK (${#oks[@]})"
  for o in "${oks[@]:-}"; do echo "- $o"; done
} >"$report_md"

python3 - <<PY
import json
from pathlib import Path
Path("$report_json").write_text(json.dumps({
  "status": "$status",
  "issues": $(printf '%s\n' "${issues[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))'),
  "warnings": $(printf '%s\n' "${warns[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))'),
  "ok": $(printf '%s\n' "${oks[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))'),
}, indent=2) + "\n")
PY

echo "Report: $report_md"
[[ "$status" == "fail" ]] && exit 1
echo "✅ Messaging port audit passed (warnings=${#warns[@]})"
