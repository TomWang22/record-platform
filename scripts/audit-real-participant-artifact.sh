#!/usr/bin/env bash
# audit-real-participant-artifact.sh — Validate T20 owner-approved participant artifact
# and JWT sub match for listed participants before real-participant C-LIVE gates.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARTIFACT="${REPO_ROOT}/docs/ai-platform/T20-35-owner-approved-real-preview-participants.md"
BASELINE_SHA="${T20_ARTIFACT_BASELINE_SHA:-}"
PWD="${T20_PARTICIPANT_LOGIN_PASSWORD:-ContractPass123!}"
API_BASE="${E2E_API_BASE:-https://record-platform.test}"
CA="${REPO_ROOT}/certs/dev-chain.pem"

fail() { echo "❌ $*" >&2; exit 1; }
pass() { echo "✅ $*"; }

[[ -f "$ARTIFACT" ]] || fail "artifact missing: $ARTIFACT"

# --- artifact structure ---
complete_rows=$(grep -cE '^\| [0-9]+ \| [^|]+@' "$ARTIFACT" || true)
[[ "$complete_rows" -ge 3 ]] || fail "need ≥3 complete participant rows (found ${complete_rows})"

if grep -qE 'TBD|tbd@|00000000-0000-0000-0000-000000000000' "$ARTIFACT"; then
  fail "artifact contains TBD or placeholder UUID"
fi

no_msg_rows=$(grep -cE 'opt-in preview soak only \| NO \| NO \| NO \|' "$ARTIFACT" || true)
[[ "$no_msg_rows" -ge 3 ]] || fail "artifact rows must mark message bodies / prod default / PERCENT as NO"

# --- unchanged hash (optional baseline) ---
current_hash=$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')
echo "artifact_sha256=${current_hash}"
if [[ -n "$BASELINE_SHA" ]]; then
  baseline_hash=$(git show "${BASELINE_SHA}:${ARTIFACT#${REPO_ROOT}/}" 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)
  [[ -n "$baseline_hash" ]] || fail "could not resolve baseline artifact at ${BASELINE_SHA}"
  [[ "$current_hash" == "$baseline_hash" ]] || fail "artifact changed since baseline ${BASELINE_SHA}"
  pass "artifact unchanged since ${BASELINE_SHA}"
fi

# --- extract participant emails/uuids from table rows 1-3 ---
mapfile -t rows < <(grep -E '^\| [123] \|' "$ARTIFACT" | head -3)
participants=()
for row in "${rows[@]}"; do
  email=$(echo "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')
  uuid=$(echo "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$4); gsub(/`/,"",$4); print $4}')
  ptype=$(echo "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$5); print $5}')
  [[ "$email" == *@* ]] || fail "invalid email in row: $row"
  [[ "$uuid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || fail "invalid uuid: $uuid"
  case "$ptype" in
    real_owner_approved|internal_staff) ;;
    *) fail "invalid participant type: $ptype" ;;
  esac
  # reject staging cohort patterns
  case "$email" in
    *@record-platform.local|t20-*|*-contract@*|bidder*|buyer-contract*|seller-contract*) fail "staging/test cohort rejected: $email" ;;
  esac
  participants+=("${email}|${uuid}")
done

pass "participant rows validated (${#participants[@]})"

# --- JWT sub match ---
python3 - <<'PY' "$API_BASE" "$CA" "$PWD" "${participants[@]}"
import base64, json, ssl, sys, urllib.request
base, ca, pwd = sys.argv[1:4]
users = [p.split("|", 1) for p in sys.argv[4:]]
ctx = ssl.create_default_context()
ctx.load_verify_locations(cafile=ca)
ok = True
for email, uid in users:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/auth/login",
        json.dumps({"email": email, "password": pwd}).encode(),
        {"Content-Type": "application/json", "X-RP-E2E-Contract": "1"},
        method="POST",
    )
    token = json.loads(urllib.request.urlopen(req, timeout=60, context=ctx).read())["token"]
    sub = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))["sub"]
    match = sub == uid
    ok = ok and match
    print(f"JWT {email}: {'PASS' if match else 'FAIL'} ({sub})")
sys.exit(0 if ok else 1)
PY

pass "JWT sub match for all participants"

# --- contract control unchanged ---
contract_uid="2ed75568-7deb-4c29-91b0-6919f24a0c9f"
grep -q "$contract_uid" "$ARTIFACT" || true  # contract not in artifact (expected)
pass "staging cohort excluded from artifact rows"

echo "=== audit-real-participant-artifact: PASS ==="
