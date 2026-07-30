#!/usr/bin/env bash
# Static Redis/Lua contract audit for Record Platform services (no secret values).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPORT_DIR="${REPORT_DIR:-bench_logs/redis-lua-contract}"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/report.md"
RESULTS="$REPORT_DIR/results.json"

SERVICES=(
  auth-service
  api-gateway
  records-service
  listings-service
  shopping-service
  messaging-service
  notification-service
  trust-service
  analytics-service
  media-service
  python-ai-service
  auction-monitor
)

critical=0
warnings=0
tmp="$(mktemp)"
printf '[' >"$tmp"

audit_svc() {
  local svc="$1"
  local dir="$REPO_ROOT/services/$svc"
  local uses=no re=present keys=0 flush=0 eval=0 och=0
  local issues=""

  if [[ ! -d "$dir" ]]; then
    printf '{"service":"%s","uses_redis":"missing-dir"},' "$svc" >>"$tmp"
    return 0
  fi

  if grep -rqiE 'redis|ioredis|makeRedis|createClient' "$dir" --include='*.ts' --include='*.js' --include='*.py' 2>/dev/null; then
    uses=yes
  fi

  if [[ "$uses" == yes ]]; then
    if ! grep -rqE 'REDIS_URL|REDIS_HOST|REDIS_PASSWORD' "$dir" --include='*.ts' --include='*.js' 2>/dev/null \
      && ! grep -rqE "name: $svc" "$REPO_ROOT/infra/k8s" 2>/dev/null; then
      :
    elif ! grep -rqE 'REDIS_URL|REDIS_HOST|REDIS_PASSWORD' "$dir" --include='*.ts' --include='*.js' 2>/dev/null \
      && ! grep -rq "REDIS" "$REPO_ROOT/infra/k8s/base" 2>/dev/null; then
      re=missing
      issues="${issues}missing-redis-env,"
      warnings=$((warnings + 1))
    fi
  else
    re=n/a
  fi

  keys=0
  if grep -rqE "redis\.call\(['\"]KEYS" "$dir" --include='*.ts' --include='*.js' --include='*.lua' --exclude-dir=dist 2>/dev/null; then
    keys=$(grep -rE "redis\.call\(['\"]KEYS" "$dir" --include='*.ts' --include='*.js' --include='*.lua' --exclude-dir=dist 2>/dev/null | wc -l | awk '{print $1}')
    issues="${issues}KEYS-in-lua,"
    critical=$((critical + 1))
  fi
  if grep -rqE '\.keys\(' "$dir" --include='*.ts' --include='*.js' 2>/dev/null | grep -vqE '__tests__|\.test\.|redis-cache'; then
    :
  fi

  flush=0
  if grep -rE 'FLUSHALL|FLUSHDB' "$dir" --include='*.ts' --include='*.js' 2>/dev/null | grep -vE '//|/\*' | grep -q .; then
    flush=$(grep -rE 'FLUSHALL|FLUSHDB' "$dir" --include='*.ts' --include='*.js' 2>/dev/null | grep -vE '//|/\*' | wc -l | awk '{print $1}')
    issues="${issues}FLUSH-in-source,"
    critical=$((critical + 1))
  fi

  eval=0
  och=0
  if grep -rqE 'EVALSHA|scriptLoad' "$dir" --include='*.ts' --include='*.js' 2>/dev/null; then
    eval=$(grep -rE 'EVALSHA|scriptLoad' "$dir" --include='*.ts' --include='*.js' 2>/dev/null | wc -l | awk '{print $1}')
  fi
  if grep -rqE "['\"]rp:|['\"]housing:" "$dir" --include='*.ts' --include='*.js' 2>/dev/null; then
    och=$(grep -rE "['\"]rp:|['\"]housing:" "$dir" --include='*.ts' --include='*.js' 2>/dev/null | wc -l | awk '{print $1}')
  fi
  if [[ "$och" -gt 0 ]]; then
    issues="${issues}rp-key-prefix,"
    critical=$((critical + 1))
  fi

  printf '{"service":"%s","uses_redis":"%s","redis_env":"%s","keys_hits":%s,"flush_hits":%s,"lua_hits":%s,"rp_prefix_hits":%s,"issues":"%s"},' \
    "$svc" "$uses" "$re" "${keys:-0}" "${flush:-0}" "${eval:-0}" "${rp:-0}" "${issues%,}" >>"$tmp"
}

{
  echo "# RP Redis/Lua contract audit"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "| Service | Redis | REDIS env | KEYS | FLUSH | Lua | RP prefix | Issues |"
  echo "|---------|-------|-----------|------|-------|-----|------------|--------|"
} >"$REPORT"

for svc in "${SERVICES[@]}"; do
  audit_svc "$svc"
done

sed -i '' '$ s/,$//' "$tmp" 2>/dev/null || sed -i '$ s/,$//' "$tmp"
echo ']' >>"$tmp"
mv "$tmp" "$RESULTS"

python3 - <<'PY' >>"$REPORT"
import json, pathlib
p = pathlib.Path("bench_logs/redis-lua-contract/results.json")
rows = json.loads(p.read_text())
for r in rows:
    print(f"| {r['service']} | {r['uses_redis']} | {r['redis_env']} | {r['keys_hits']} | {r['flush_hits']} | {r['lua_hits']} | {r['rp_prefix_hits']} | {r['issues'] or '—'} |")
PY

echo "" >>"$REPORT"
echo "Critical findings: **$critical**" >>"$REPORT"
echo "Warnings: **$warnings**" >>"$REPORT"

if [[ $critical -gt 0 ]]; then
  echo "❌ Redis/Lua audit: $critical critical — $REPORT" >&2
  exit 1
fi
echo "✅ Redis/Lua audit passed — $REPORT"
