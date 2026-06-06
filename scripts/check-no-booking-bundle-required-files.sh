#!/usr/bin/env bash
# Verify required infrastructure paths exist inside the no-booking bundle (not just file counts).
#
# Usage: bash scripts/check-no-booking-bundle-required-files.sh /path/to/bundle.tar.gz
set -euo pipefail

TARBALL="${1:?usage: $0 /path/to/bundle.tar.gz}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/scripts/lib/no-booking-bundle-required-paths.txt"
REPORT="$ROOT/reports/no-booking-bundle-required-files.txt"
mkdir -p "$ROOT/reports"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: missing $MANIFEST" >&2
  exit 1
fi

PREFIX="$(tar -tzf "$TARBALL" | awk -F/ '{print $1}' | sort -u)"
if [[ $(echo "$PREFIX" | wc -l | tr -d ' ') -ne 1 ]]; then
  echo "ERROR: expected single top-level dir in tarball" >&2
  exit 1
fi

TAR_LIST="$(mktemp)"
trap 'rm -f "$TAR_LIST"' EXIT
tar -tzf "$TARBALL" | sed "s|^${PREFIX}/||" | grep -v '/$' | sort -u >"$TAR_LIST"

missing=0
present=0
{
  echo "# Required file presence in bundle"
  echo "# tarball: $TARBALL"
  echo "# prefix: ${PREFIX}/"
  echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "path\tstatus"
} >"$REPORT"

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue
  if grep -Fxq "$line" "$TAR_LIST"; then
    echo -e "${line}\tOK" >>"$REPORT"
    present=$((present + 1))
  else
    echo -e "${line}\tMISSING" >>"$REPORT"
    missing=$((missing + 1))
    echo "MISSING: $line" >&2
  fi
done <"$MANIFEST"

# Directory checks (at least one file under prefix)
check_dir() {
  local dir="$1"
  if grep -q "^${dir}/" "$TAR_LIST"; then
    echo -e "${dir}/\tOK_DIR" >>"$REPORT"
    present=$((present + 1))
  else
    echo -e "${dir}/\tMISSING_DIR" >>"$REPORT"
    missing=$((missing + 1))
    echo "MISSING DIR: $dir/" >&2
  fi
}

for dir in infra/k8s/kafka-kraft-metallb infra/k8s/kafka-certs scripts/coverage; do
  check_dir "$dir"
done

echo
echo "Required paths: $present OK, $missing missing"
echo "Report: $REPORT"
cat "$REPORT"

if [[ "$missing" -gt 0 ]]; then
  exit 1
fi
echo "PASS: all required infrastructure files present in bundle"
