#!/usr/bin/env bash
# Scan RP runtime paths for forbidden OCH/housing strings.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOWLIST="${RP_OCH_ALLOWLIST:-$REPO_ROOT/config/rp-och-allowlist.txt}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/domain-comb}"
REPORT="${REPORT:-$REPORT_DIR/rp-och-code-comb.md}"
SCAN_BENCH_LOGS="${SCAN_BENCH_LOGS:-0}"

mkdir -p "$REPORT_DIR"

# Word-boundary ripgrep patterns (multiline off)
RG_PATTERNS=(
  '\bOCH\b'
  'off[- ]campus'
  '\bhousing\b'
  '\blandlord\b'
  '\bbooking\b'
  '\bbookings\b'
  '\bapartment\b'
  'residence_type'
  'landlord_display'
  'Send in OCH'
  '\bfurnished\b'
  'housing-media'
  'off-campus-housing'
)

SCAN_DIRS=()
for d in webapp/app webapp/components webapp/lib webapp/e2e services infra k8s scripts; do
  [[ -e "$REPO_ROOT/$d" ]] && SCAN_DIRS+=("$REPO_ROOT/$d")
done
while IFS= read -r -d '' f; do
  SCAN_DIRS+=("$f")
done < <(find "$REPO_ROOT/services" -maxdepth 3 -name 'schema.prisma' -print0 2>/dev/null)

for base in "$REPO_ROOT/webapp/e2e/screenshots/authenticated" "$REPO_ROOT/webapp/e2e/screenshots/guest"; do
  [[ -d "$base" ]] || continue
  for dir in "$base"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
    [[ -d "$dir" ]] && SCAN_DIRS+=("$dir")
  done
done
[[ "$SCAN_BENCH_LOGS" == "1" && -d "$REPO_ROOT/bench_logs" ]] && SCAN_DIRS+=("$REPO_ROOT/bench_logs")

RG_GLOBS=(
  -g '!**/node_modules/**'
  -g '!**/.next/**'
  -g '!**/dist/**'
  -g '!**/coverage/**'
  -g '!**/backups/**'
  -g '!**/_archive/**'
  -g '!**/*.png'
  -g '!**/*.jpg'
  -g '!**/*.jpeg'
  -g '!**/*.gif'
  -g '!**/*.map'
  -g '!**/*.min.js'
  -g '!**/*.tsbuildinfo'
  -g '!**/generated/**'
  -g '!**/prisma/generated/**'
  -g '!**/*.wasm.js'
)

PATH_RULES_FILE=""
LINE_RULES_FILE=""
MATCH_RULES_FILE=""

load_allowlist() {
  PATH_RULES_FILE="$(mktemp)"
  LINE_RULES_FILE="$(mktemp)"
  MATCH_RULES_FILE="$(mktemp)"
  [[ -f "$ALLOWLIST" ]] || return 0
  while IFS= read -r rule || [[ -n "${rule:-}" ]]; do
    rule="${rule%%#*}"
    rule="$(echo "$rule" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$rule" ]] && continue
    case "$rule" in
      path:*) echo "${rule#path:}" >>"$PATH_RULES_FILE" ;;
      line:*) echo "${rule#line:}" >>"$LINE_RULES_FILE" ;;
      match:*) echo "${rule#match:}" >>"$MATCH_RULES_FILE" ;;
    esac
  done <"$ALLOWLIST"
}

path_rule_matches() {
  local rel="$1" g="$2"
  if [[ "$g" == *'/**' ]]; then
    local prefix="${g%/\*\*}"
    prefix="${prefix%/}"
    [[ "$rel" == "$prefix" || "$rel" == "$prefix"/* ]]
    return
  fi
  [[ "$rel" == "$g" ]]
}

is_allowed() {
  local rel="$1" line_no="$2" line_text="$3"
  if [[ -f "$PATH_RULES_FILE" ]]; then
    while IFS= read -r g; do
      [[ -z "$g" ]] && continue
      path_rule_matches "$rel" "$g" && return 0
    done <"$PATH_RULES_FILE"
  fi
  if [[ -f "$LINE_RULES_FILE" ]]; then
    while IFS= read -r spec; do
      [[ -z "$spec" ]] && continue
      local f="${spec%%:*}"
      local n="${spec##*:}"
      [[ "$rel" == "$f" && "$line_no" == "$n" ]] && return 0
    done <"$LINE_RULES_FILE"
  fi
  if [[ -f "$MATCH_RULES_FILE" ]]; then
    while IFS= read -r spec; do
      [[ -z "$spec" ]] && continue
      local f="${spec%%:*}"
      local sub="${spec#*:}"
      [[ "$rel" == "$f" && "$line_text" == *"$sub"* ]] && return 0
    done <"$MATCH_RULES_FILE"
  fi
  return 1
}

load_allowlist
trap 'rm -f "$PATH_RULES_FILE" "$LINE_RULES_FILE" "$MATCH_RULES_FILE"' EXIT

hits=()
raw_hits="$REPO_ROOT/bench_logs/domain-comb/.och-scan-raw.txt"
mkdir -p "$(dirname "$raw_hits")"

if command -v rg >/dev/null 2>&1; then
  rg -n -i --no-heading "${RG_PATTERNS[@]}" "${RG_GLOBS[@]}" "${SCAN_DIRS[@]}" 2>/dev/null >"$raw_hits" || true
else
  grep -rn -i -E "$(IFS='|'; echo "${RG_PATTERNS[*]}")" "${SCAN_DIRS[@]}" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    >"$raw_hits" 2>/dev/null || true
fi

filtered="$REPO_ROOT/bench_logs/domain-comb/.och-scan-filtered.txt"
python3 - "$REPO_ROOT" "$ALLOWLIST" "$raw_hits" >"$filtered" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
allow_path = Path(sys.argv[2])
raw_path = Path(sys.argv[3])

path_rules = []
line_rules = []
match_rules = []
if allow_path.is_file():
    for line in allow_path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("path:"):
            path_rules.append(line[5:])
        elif line.startswith("line:"):
            spec = line[5:]
            f, _, n = spec.partition(":")
            line_rules.append((f, n))
        elif line.startswith("match:"):
            spec = line[6:]
            f, _, sub = spec.partition(":")
            match_rules.append((f, sub))

def path_ok(rel: str) -> bool:
    for g in path_rules:
        if g.endswith("/**"):
            prefix = g[:-3].rstrip("/")
            if rel == prefix or rel.startswith(prefix + "/"):
                return True
        elif rel == g:
            return True
    return False

def allowed(rel: str, ln: str, text: str) -> bool:
    if path_ok(rel):
        return True
    for f, n in line_rules:
        if rel == f and ln == n:
            return True
    for f, sub in match_rules:
        if rel == f and sub in text:
            return True
    return False

scanned = 0
for line in raw_path.read_text().splitlines():
    if not line.strip():
        continue
    scanned += 1
    parts = line.split(":", 2)
    if len(parts) < 3:
        continue
    rel_path, ln, text = parts[0], parts[1], parts[2]
    rel = str(Path(rel_path).relative_to(root)) if rel_path.startswith(str(root)) else rel_path
    if not allowed(rel, ln, text):
        print(f"{rel}:{ln}:{text}")
print(f"__SCANNED__={scanned}", file=sys.stderr)
PY
scanned="$(grep -c . "$raw_hits" 2>/dev/null || echo 0)"
mapfile -t hits <"$filtered"

# PNG filenames in active screenshot dirs
for dir in "${SCAN_DIRS[@]}"; do
  [[ "$dir" == *screenshots* ]] || continue
  while IFS= read -r -d '' f; do
    rel="${f#$REPO_ROOT/}"
    bn="$(basename "$f" | tr '[:upper:]' '[:lower:]')"
    for tok in och housing landlord booking apartment off-campus; do
      if [[ "$bn" == *"${tok// /-}"* ]] && ! is_allowed "$rel" 0 "$bn"; then
        hits+=("$rel:0:filename:$tok")
      fi
    done
  done < <(find "$dir" -maxdepth 1 -name '*.png' -print0 2>/dev/null)
done

{
  echo "# RP/OCH code comb"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Allowlist: \`$ALLOWLIST\`"
  echo "Raw hits scanned: $scanned"
  echo ""
  if [[ ${#hits[@]} -eq 0 ]]; then
    echo "**PASS** — no unallowlisted OCH/housing hits."
    echo ""
    echo "Scope: \`webapp/app\`, \`webapp/components\`, \`webapp/lib\`, active contract screenshots; \`services/**\` and \`scripts/**\` allowlisted as legacy ops/schema (see config/rp-och-allowlist.txt)."
  else
    echo "**FAIL** — ${#hits[@]} unallowlisted hit(s):"
    echo ""
    echo '```'
    printf '%s\n' "${hits[@]}" | head -200
    echo '```'
    [[ ${#hits[@]} -gt 200 ]] && echo "_truncated to 200 lines_" 
  fi
} >"$REPORT"

if [[ ${#hits[@]} -gt 0 ]]; then
  echo "OCH code comb FAILED — $REPORT (${#hits[@]} hits)" >&2
  exit 1
fi
echo "OCH code comb PASS — $REPORT"
exit 0
