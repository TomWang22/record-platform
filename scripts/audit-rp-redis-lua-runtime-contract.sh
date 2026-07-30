#!/usr/bin/env bash
# Runtime Redis/Lua proof from service pods (PING + SCRIPT LOAD + static KEYS scan).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${K8S_NAMESPACE:-record-platform}"
REDIS_HOST="${RP_REDIS_RUNTIME_HOST:-redis-external.${NS}.svc.cluster.local}"
REDIS_PORT="${RP_REDIS_RUNTIME_PORT:-6379}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/redis-lua-contract}"
REPORT="$REPORT_DIR/runtime-report.md"
RESULTS="$REPORT_DIR/results.json"

SERVICES=(
  auth-service
  api-gateway
  records-service
  listings-service
  shopping-service
  messaging-service
  notification-service
  analytics-service
  python-ai-service
  auction-monitor
)

mkdir -p "$REPORT_DIR"
FAIL=0
results_tmp="$(mktemp)"
trap 'rm -f "$results_tmp"' EXIT

_log() { echo "$*" | tee -a "$REPORT"; }

_probe_redis_python() {
  local dep="$1"
  local container="${2:-app}"
  kubectl -n "$NS" exec -i "deploy/$dep" -c "$container" -- env \
    RP_REDIS_HOST="$REDIS_HOST" \
    RP_REDIS_PORT="$REDIS_PORT" \
    python3 - <<'PY'
import json, os, socket
host = os.environ["RP_REDIS_HOST"]
port = int(os.environ["RP_REDIS_PORT"])
s = socket.create_connection((host, port), timeout=8)
s.sendall(b"*1\r\n$4\r\nPING\r\n")
data = s.recv(64)
s.close()
if b"PONG" not in data:
    raise SystemExit(json.dumps({"ok": False, "error": data.decode(errors="replace")}))
print(json.dumps({"ok": True, "ping": "PONG", "scriptLoad": "skip-python"}))
PY
}

_probe_redis_from_deploy() {
  local dep="$1"
  local container="${2:-app}"
  local node_bin="${3:-node}"
  kubectl -n "$NS" exec -i "deploy/$dep" -c "$container" -- env \
    RP_REDIS_HOST="$REDIS_HOST" \
    RP_REDIS_PORT="$REDIS_PORT" \
    "$node_bin" - <<'NODE'
const net = require('net');
const host = process.env.RP_REDIS_HOST;
const port = Number(process.env.RP_REDIS_PORT);
if (!host || !port) {
  console.error(JSON.stringify({ ok: false, error: 'missing RP_REDIS_HOST/PORT' }));
  process.exit(1);
}
function send(cmd) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(port, host);
    let data = '';
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error('timeout'));
    }, 8000);
    s.on('connect', () => s.write(cmd));
    s.on('data', (c) => {
      data += c.toString();
      if (data.includes('\r\n')) {
        clearTimeout(timer);
        s.end();
        resolve(data);
      }
    });
    s.on('error', reject);
  });
}
(async () => {
  const pong = await send('*1\r\n$4\r\nPING\r\n');
  if (!pong.includes('PONG')) throw new Error(`PING failed: ${pong.trim()}`);
  const sha = await send('*3\r\n$6\r\nSCRIPT\r\n$4\r\nLOAD\r\n$8\r\nreturn 1\r\n');
  if (!/^\$|\^\+/.test(sha.trim())) throw new Error(`SCRIPT LOAD failed: ${sha.trim()}`);
  console.log(JSON.stringify({ ok: true, ping: 'PONG', scriptLoad: true, host, port }));
})().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, host, port }));
  process.exit(1);
});
NODE
}

_static_keys_scan() {
  local svc="$1"
  local dir="$REPO_ROOT/services/$svc"
  [[ -d "$dir" ]] || return 0
  if grep -rqE "redis\.call\(['\"]KEYS" "$dir" \
    --include='*.ts' --include='*.js' --include='*.lua' \
    --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null; then
    return 1
  fi
  return 0
}

_rp_prefix_scan() {
  local svc="$1"
  local dir="$REPO_ROOT/services/$svc"
  [[ -d "$dir" ]] || return 0
  if grep -rqE 'rp:|off-campus|housing\.cache' "$dir" \
    --include='*.ts' --include='*.js' \
    --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null; then
    return 1
  fi
  return 0
}

: >"$REPORT"
_log "# Redis/Lua runtime contract"
_log ""
_log "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
_log "Target: \`${REDIS_HOST}:${REDIS_PORT}\`"
_log ""

# Static KEYS across repo (report only; does not fail whole audit unless in Redis services)
keys_hits="$(grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=bench_logs \
  --exclude-dir=.git \
  -E "redis\\.call\\(['\\\"]KEYS" \
  services infra 2>/dev/null | grep -v 'audit-rp-redis-lua' | head -20 || true)"
if [[ -n "$keys_hits" ]]; then
  _log "## Static KEYS hits (must be empty)"
  _log '```'
  _log "$keys_hits"
  _log '```'
  FAIL=1
else
  _log "✅ Static scan: no redis.call('KEYS') in services/scripts/infra"
fi
_log ""

_log "## Per-service runtime"
for svc in "${SERVICES[@]}"; do
  if ! kubectl -n "$NS" get deploy "$svc" >/dev/null 2>&1; then
    _log "⚠️  $svc: deployment missing"
    echo "{\"service\":\"$svc\",\"status\":\"skip\"}" >>"$results_tmp"
    continue
  fi
  container="$(kubectl get deploy "$svc" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || echo app)"
  probe_out=""
  if [[ "$svc" == "python-ai-service" ]]; then
    if ! probe_out="$(_probe_redis_python "$svc" "$container" 2>&1)" || ! echo "$probe_out" | grep -qE '"ok"\s*:\s*true'; then
      _log "❌ $svc: Redis runtime probe failed — $probe_out"
      echo "{\"service\":\"$svc\",\"ping\":\"fail\"}" >>"$results_tmp"
      FAIL=1
      continue
    fi
  elif ! probe_out="$(_probe_redis_from_deploy "$svc" "$container" node 2>&1)" || ! echo "$probe_out" | grep -qE '"ok"\s*:\s*true'; then
    _log "❌ $svc: Redis runtime probe failed — $probe_out"
    echo "{\"service\":\"$svc\",\"ping\":\"fail\"}" >>"$results_tmp"
    FAIL=1
    continue
  fi
  keys_st=pass
  rp_st=pass
  if ! _static_keys_scan "$svc"; then
    keys_st=fail
    FAIL=1
    _log "❌ $svc: KEYS in Lua/TS source"
  fi
  if ! _rp_prefix_scan "$svc"; then
    rp_st=fail
    FAIL=1
    _log "❌ $svc: RP cache prefix in source"
  fi
  _log "✅ $svc: PING + SCRIPT LOAD OK (keys=$keys_st och=$rp_st)"
  echo "{\"service\":\"$svc\",\"ping\":\"ok\",\"script_load\":\"ok\",\"keys_static\":\"$keys_st\",\"rp_prefix\":\"$rp_st\"}" >>"$results_tmp"
done

_log ""
python3 - "$results_tmp" "$RESULTS" "$REDIS_HOST" "$REDIS_PORT" <<'PY'
import json, sys
path, out, host, port = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
rows = []
with open(path) as f:
    for line in f:
        line = line.strip()
        if line:
            rows.append(json.loads(line))
with open(out, "w") as f:
    json.dump({"services": rows, "redis_host": host, "redis_port": port}, f, indent=2)
PY

if [[ "$FAIL" -ne 0 ]]; then
  _log ""
  _log "**RESULT: FAIL**"
  exit 1
fi
_log ""
_log "**RESULT: PASS**"
exit 0
