#!/usr/bin/env bash
# Audit transactional outbox: DDL, Prisma, direct Kafka publishes, publisher wiring.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/outbox-audit}"
mkdir -p "$OUT_DIR"

issues=()
warns=()
oks=()

add_issue() { issues+=("$1"); }
add_warn() { warns+=("$1"); }
add_ok() { oks+=("$1"); }

# Expected: service -> port -> outbox sql stem
declare -A SERVICE_PORT=(
  [auth-service]=5437
  [records-service]=5433
  [listings-service]=5435
  [shopping-service]=5436
  [messaging-service]=5434
  [notification-service]=5441
  [trust-service]=5442
  [media-service]=5443
  [analytics-service]=5439
  [auction-monitor]=5438
  [python-ai-service]=5440
)

OUTBOX_SQL=(
  01-auth-outbox.sql
  01-records-outbox.sql
  03-listings-outbox.sql
  01-shopping-outbox.sql
  02-messaging-outbox.sql
  03-notification-outbox.sql
  03-trust-outbox.sql
  02-media-outbox.sql
  03-analytics-outbox.sql
  01-auction-monitor-outbox.sql
  01-ai-outbox.sql
)

for sql in "${OUTBOX_SQL[@]}"; do
  [[ -f "infra/db/$sql" ]] && add_ok "infra/db/$sql" || add_issue "missing infra/db/$sql"
done

[[ -f docs/architecture/TRANSACTIONAL_OUTBOX.md ]] && add_ok "TRANSACTIONAL_OUTBOX.md" || add_issue "missing docs/architecture/TRANSACTIONAL_OUTBOX.md"
[[ -f infra/contracts/outbox-contract.json ]] && add_ok "outbox-contract.json" || add_issue "missing infra/contracts/outbox-contract.json"

# Prisma / service outbox mentions
for svc in auth-service records-service listings-service shopping-service messaging-service \
  notification-service trust-service media-service analytics-service auction-monitor python-ai-service; do
  prisma="services/$svc/prisma/schema.prisma"
  if [[ -f "$prisma" ]]; then
    if grep -qi 'outbox' "$prisma"; then
      add_ok "$svc Prisma references outbox"
    else
      add_warn "$svc Prisma has no outbox model (may use raw SQL migration only)"
    fi
  fi
  pub="$(find "services/$svc" -name '*outbox*' -o -name '*publisher*' 2>/dev/null | head -5)"
  if [[ -n "$pub" ]]; then
    add_ok "$svc has outbox/publisher files"
  else
    add_warn "$svc: no outbox publisher file found by name"
  fi
done

# Direct Kafka after DB write (heuristic)
for svc_dir in services/*/src services/*/*/src; do
  [[ -d "$svc_dir" ]] || continue
  while IFS= read -r -d '' f; do
    if grep -q 'producer\.send\|kafka.*publish\|publishEvent' "$f" 2>/dev/null; then
      if grep -q 'outbox' "$f" 2>/dev/null; then continue; fi
      rel="${f#services/}"
      add_warn "possible direct Kafka publish (no outbox in same file): $rel"
    fi
  done < <(find "$svc_dir" -name '*.ts' -print0 2>/dev/null | head -z -200)
done 2>/dev/null || true

# Stale social outbox on active path
[[ -f infra/db/01-social-outbox.sql ]] && add_warn "01-social-outbox.sql exists (social skipped — do not restore to 5434)"

# Host DB outbox tables when Postgres up
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
if command -v psql >/dev/null 2>&1; then
  for svc in "${!SERVICE_PORT[@]}"; do
    port="${SERVICE_PORT[$svc]}"
    db=""
    case "$port" in
      5437) db=auth ;;
      5433) db=records ;;
      5434) db=messaging ;;
      5435) db=listings ;;
      5436) db=shopping ;;
      5438) db=postgres ;;
      5439) db=analytics ;;
      5440) db=python_ai ;;
      5441) db=notification ;;
      5442) db=trust ;;
      5443) db=media ;;
    esac
    [[ -z "$db" ]] && continue
    if psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -tAc \
      "SELECT 1 FROM information_schema.tables WHERE table_name LIKE '%outbox%' LIMIT 1" 2>/dev/null | grep -q 1; then
      add_ok "host DB :$port/$db has outbox table"
    else
      add_warn "host DB :$port/$db: no outbox table visible (restore/migrate may be pending)"
    fi
  done
else
  add_warn "psql not available — skipped live DB outbox table checks"
fi

bash scripts/verify-outbox-infra-alignment.sh >/dev/null 2>&1 && add_ok "verify-outbox-infra-alignment.sh" || add_issue "verify-outbox-infra-alignment.sh failed"

status="pass"
[[ ${#issues[@]} -gt 0 ]] && status="fail"

report_md="$OUT_DIR/report.md"
report_json="$OUT_DIR/report.json"

{
  echo "# Outbox pattern audit"
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
}, indent=2) + "\n")
PY

echo "Report: $report_md"
[[ "$status" == "fail" ]] && exit 1
echo "✅ Outbox audit passed (warnings=${#warns[@]} — review before new outbox code)"
