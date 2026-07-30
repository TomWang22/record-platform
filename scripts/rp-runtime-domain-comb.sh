#!/usr/bin/env bash
# Call edge APIs; fail on RP domain contamination (not transient 5xx during warmup).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"
# shellcheck source=lib/rp-cluster-readiness.sh
source "$SCRIPT_DIR/lib/rp-cluster-readiness.sh"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

NS="${K8S_NAMESPACE:-record-platform}"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/domain-comb}"
REPORT="${REPORT:-$REPORT_DIR/rp-rp-runtime-api-comb.md}"
HARDENING_REPORT="${REPORT_DIR}/runtime-comb-readiness-hardening.md"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"

mkdir -p "$REPORT_DIR"

FORBIDDEN_KEYS=(
  residence_type landlord_display landlord_id tenant_id
  bedrooms bathrooms lease_length_months effective_from effective_until
  distance_miles_to_campus price_usd_monthly furnished smoke_free pet_friendly
  lease_terms listing_on_hold soft_hold_until availability_status
  square_feet
)

FORBIDDEN_STRINGS=(
  'RP' 'off-campus' 'off campus' 'housing' 'landlord' 'tenant' 'booking'
  'apartment' 'Send in RP' 'furnished' 'lease terms'
)

DEPLOYS=(
  auth-service records-service listings-service shopping-service messaging-service
  trust-service analytics-service media-service notification-service api-gateway
  python-ai-service auction-monitor webapp
)

SERVICES=(
  auth-service records-service listings-service shopping-service messaging-service
  trust-service analytics-service media-service notification-service api-gateway
  python-ai-service auction-monitor webapp
)

if command -v kubectl >/dev/null 2>&1; then
  {
    echo "# Runtime comb readiness hardening"
    echo ""
    echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
  } >"$HARDENING_REPORT"
  rp_wait_deployments_available "$NS" "${DEPLOYS[@]}" 2>&1 | tee -a "$HARDENING_REPORT" || {
    echo "❌ deployment readiness wait failed" | tee -a "$HARDENING_REPORT" >&2
    exit 1
  }
  rp_wait_service_endpoints "$NS" "${SERVICES[@]}" 2>&1 | tee -a "$HARDENING_REPORT" || {
    echo "❌ service endpoints wait failed" | tee -a "$HARDENING_REPORT" >&2
    exit 1
  }
  for path in /healthz /api/readyz; do
    code="$(rp_curl_with_retry 8 -sS -o /dev/null -w '%{http_code}' "$BASE$path" --cacert "$CA" 2>/dev/null || echo "000")"
    echo "Edge $path → HTTP $code" | tee -a "$HARDENING_REPORT"
    [[ "$code" == "200" ]] || { echo "❌ edge not healthy: $path HTTP $code" >&2; exit 1; }
  done
fi

export RP_FORBIDDEN_KEYS="${FORBIDDEN_KEYS[*]}"
export RP_FORBIDDEN_STRINGS="${FORBIDDEN_STRINGS[*]}"

token=""
for attempt in $(seq 1 8); do
  token="$(curl -sS -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
    --cacert "$CA" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"
  [[ -n "$token" ]] && break
  sleep "$((attempt * 2))"
done
if [[ -z "$token" ]]; then
  echo "service_unavailable: auth login failed after retries — $BASE/api/auth/login" >&2
  exit 1
fi

endpoints=(
  "/api/listings/search?limit=20"
  "/api/listings/mine"
  "/api/records"
  "/api/profile/feedback"
  "/api/notifications"
  "/api/messages/conversations"
  "/api/shopping/watchlist"
  "/api/shopping/recently-viewed"
  "/api/webapp-version"
)

check_json() {
  local path="$1" body="$2"
  printf '%s' "$body" | python3 - "$path" <<'PY'
import json, os, re, sys
path = sys.argv[1]
raw = sys.stdin.read()
try:
    data = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError as e:
    print(f"{path}:json_parse:{e}")
    sys.exit(0)

keys = set(os.environ.get("RP_FORBIDDEN_KEYS", "").split())
strings = os.environ.get("RP_FORBIDDEN_STRINGS", "").split()

def key_hits(obj, prefix=""):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            if k in keys:
                found.append(full)
            found.extend(key_hits(v, full))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            found.extend(key_hits(item, f"{prefix}[{i}]"))
    return found

def string_hits(obj):
    found = []
    text = json.dumps(obj, ensure_ascii=False)
    low = text.lower()
    for s in strings:
        if s == "RP":
            if re.search(r"\bOCH\b", text):
                found.append("RP")
        elif s in ("off-campus", "off campus"):
            if re.search(r"off[- ]campus", low):
                found.append(s)
        else:
            if re.search(rf"\b{re.escape(s)}\b", low, re.I):
                found.append(s)
    return found

kh = key_hits(data)
sh = string_hits(data)
if kh or sh:
    parts = []
    if kh:
        parts.append("keys=" + ",".join(kh[:20]))
    if sh:
        parts.append("strings=" + ",".join(sorted(set(sh))))
    print(f"{path}:domain_violation:{' ; '.join(parts)}")
PY
}

domain_hits=()
infra_hits=()

for ep in "${endpoints[@]}"; do
  code=""
  body=""
  for attempt in $(seq 1 5); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE$ep" -H "Authorization: Bearer $token" --cacert "$CA" 2>/dev/null || echo "000")"
    body="$(curl -sS "$BASE$ep" -H "Authorization: Bearer $token" --cacert "$CA" 2>/dev/null || true)"
    if [[ "$code" == "200" || "$code" == "201" ]]; then
      break
    fi
    if [[ "$ep" == "/api/notifications" && ( "$code" == "401" || "$code" == "200" ) ]]; then
      break
    fi
    if [[ "$ep" == "/api/webapp-version" && ( "$code" == "401" || "$code" == "200" ) ]]; then
      break
    fi
    sleep "$((attempt * 2))"
  done

  if [[ "$code" != "200" && "$code" != "201" ]]; then
    if [[ "$ep" == "/api/notifications" && "$code" == "401" ]]; then
      continue
    fi
    if [[ "$ep" == "/api/webapp-version" && ( "$code" == "401" || "$code" == "200" ) ]]; then
      continue
    fi
    infra_hits+=("$ep:service_unavailable:HTTP $code")
    continue
  fi

  while IFS= read -r h; do
    [[ -z "$h" ]] && continue
    if [[ "$h" == *:domain_violation:* ]]; then
      domain_hits+=("$h")
    else
      infra_hits+=("$h")
    fi
  done < <(check_json "$ep" "$body")
done

{
  echo "# RP/RP runtime API comb"
  echo ""
  echo "Base: \`$BASE\`"
  echo "User: \`$EMAIL\`"
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  if [[ ${#domain_hits[@]} -eq 0 && ${#infra_hits[@]} -eq 0 ]]; then
    echo "**PASS** — no forbidden keys or strings; edge healthy after readiness wait."
  else
    [[ ${#domain_hits[@]} -gt 0 ]] && echo "**Domain violations:** ${#domain_hits[@]}"
    [[ ${#infra_hits[@]} -gt 0 ]] && echo "**Infrastructure / availability:** ${#infra_hits[@]}"
    echo ""
    for h in "${domain_hits[@]}"; do echo "- $h"; done
    for h in "${infra_hits[@]}"; do echo "- $h"; done
  fi
} >"$REPORT"

if [[ ${#infra_hits[@]} -gt 0 ]]; then
  echo "Runtime API comb FAILED (service_unavailable) — $REPORT" >&2
  exit 1
fi
if [[ ${#domain_hits[@]} -gt 0 ]]; then
  echo "Runtime API comb FAILED (domain_violation) — $REPORT" >&2
  exit 1
fi
echo "Runtime API comb PASS — $REPORT"
exit 0
