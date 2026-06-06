#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
BASE_URL="${BASE_URL:-http://api-gateway.record-platform.svc.cluster.local:4000}"
MODE="${MODE:-mixed}"
RATE="${RATE:-50}"
DURATION="${DURATION:-5m}"
VUS="${VUS:-20}"
MAX_VUS="${MAX_VUS:-200}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== k6 Load Testing Suite ==="
echo "Configuration:"
echo "  Namespace: $NS"
echo "  Base URL: $BASE_URL"
echo "  Mode: $MODE"
echo "  Rate: $RATE req/s"
echo "  Duration: $DURATION"
echo "  VUs: $VUS (max: $MAX_VUS)"
echo ""

# Check if running in-cluster or locally
if kubectl cluster-info >/dev/null 2>&1; then
  RUN_MODE="in-cluster"
  ok "Running tests in-cluster (Kubernetes)"
else
  RUN_MODE="local"
  warn "Not connected to cluster - will use local URLs"
  BASE_URL="${BASE_URL:-http://localhost:8080}"
fi

# Test 1: All-in-One k6 Test (Main Pipeline Test)
say "Test 1: All-in-One Pipeline Test"
echo "This tests the full pipeline: auth, records CRUD, mixed workload"
echo ""

if [[ "$RUN_MODE" == "in-cluster" ]]; then
  # Run k6 in-cluster using kubectl run
  TEST_NAME="k6-test-$(date +%s)"
  kubectl -n "$NS" run "$TEST_NAME" --rm -i --restart=Never \
    --image=grafana/k6:latest \
    --env="BASE_URL=$BASE_URL" \
    --env="MODE=$MODE" \
    --env="RATE=$RATE" \
    --env="DURATION=$DURATION" \
    --env="VUS=$VUS" \
    --env="MAX_VUS=$MAX_VUS" \
    --env="EMAIL=t@t.t" \
    --env="PASS=p@ssw0rd" \
    -- \
    k6 run --stdout /dev/stdin <<'K6_SCRIPT'
import http from 'k6/http';
import { check, sleep } from 'k6';

const RAW_BASE = __ENV.BASE_URL || 'http://api-gateway:4000';
const API_BASE = RAW_BASE.replace(/\/$/, '');
const EMAIL = __ENV.EMAIL || 't@t.t';
const PASS = __ENV.PASS || 'p@ssw0rd';
const MODE = (__ENV.MODE || 'mixed').toLowerCase();
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '5m';
const VUS = Number(__ENV.VUS || 20);
const MAX_VUS = Number(__ENV.MAX_VUS || 200);

function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

let token;
function login() {
  const payload = JSON.stringify({ email: EMAIL, password: PASS });
  const res = http.post(apiUrl('/auth/login'), payload, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (res.status === 200) {
    const body = res.json();
    return body.token || body.accessToken || '';
  }
  return '';
}

export function setup() {
  token = login();
  if (!token) throw new Error('Login failed');
  return { token };
}

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    checks: ['rate>0.98'],
  },
};

export default function(data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' } };
  
  // Mixed workload: 70% reads, 30% writes
  const roll = Math.random() * 100;
  if (roll < 70) {
    // Read: list records
    const res = http.get(apiUrl('/records'), auth);
    check(res, { 'GET /records 2xx': r => r.status >= 200 && r.status < 300 });
  } else {
    // Write: create record
    const payload = JSON.stringify({
      artist: 'k6 Test',
      name: `k6 Record ${Date.now()}`,
      format: 'LP',
    });
    const res = http.post(apiUrl('/records'), payload, auth);
    check(res, { 'POST /records 2xx': r => r.status >= 200 && r.status < 300 });
  }
  sleep(Math.random() * 0.2);
}
K6_SCRIPT
else
  # Run locally (requires k6 installed and port-forward)
  warn "Local mode - ensure port-forward is running:"
  echo "  kubectl -n $NS port-forward svc/api-gateway 8080:4000"
  echo ""
  read -p "Press Enter when port-forward is ready, or Ctrl+C to cancel..."
  
  if command -v k6 >/dev/null 2>&1; then
    k6 run \
      --env BASE_URL="$BASE_URL" \
      --env MODE="$MODE" \
      --env RATE="$RATE" \
      --env DURATION="$DURATION" \
      --env VUS="$VUS" \
      --env MAX_VUS="$MAX_VUS" \
      scripts/load/all-in-one-k6.js
  else
    warn "k6 not installed locally. Install with: brew install k6"
    echo "Or run in-cluster by connecting to Kubernetes cluster"
  fi
fi

say "=== Test Complete ==="
echo ""
echo "Next steps:"
echo "1. Run analytics pipeline tests: ./scripts/load/run-analytics-tests.sh"
echo "2. Run pipeline load test: ./scripts/load/run-pipeline-load-test.sh"
echo "3. View detailed results in scripts/load/results/"

