#!/usr/bin/env bash
# Recursive folder parity: source repo vs extracted no-booking bundle at every directory level.
# Uses the same exclude rules as package-och-platform-no-booking-bundle.sh.
#
# Usage: bash scripts/compare-bundle-folder-counts.sh /path/to/bundle.tar.gz [top|all]
#   top — only compare top-level folder buckets
#   all — every parent path (services/auth-service, scripts/coverage, infra/k8s/base, …)
set -euo pipefail

TARBALL="${1:?usage: $0 /path/to/bundle.tar.gz [top|all]}"
MODE="${2:-all}"

if [[ "$MODE" != "top" && "$MODE" != "all" ]]; then
  echo "usage: $0 /path/to/bundle.tar.gz [top|all]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/no-booking-bundle-excludes.sh
source "$ROOT/scripts/lib/no-booking-bundle-excludes.sh"

REPORT_DIR="$ROOT/reports"
mkdir -p "$REPORT_DIR"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

SOURCE_LIST="$REPORT_DIR/no-booking-bundle-folder-source-files.txt"
BUNDLE_LIST="$REPORT_DIR/no-booking-bundle-folder-archive-files.txt"
REPORT="$REPORT_DIR/no-booking-bundle-folder-counts.txt"
MISSING_REPORT="$REPORT_DIR/no-booking-bundle-missing-files.txt"
EXTRA_REPORT="$REPORT_DIR/no-booking-bundle-extra-files.txt"

BUNDLE_ONLY=(
  MANIFEST.txt
  README_BUNDLE.txt
  EXCLUDED.txt
  PORTS_AND_CONFLICTS.txt
)

echo "== Extracting bundle =="
tar -xzf "$TARBALL" -C "$TMP"

BUNDLE_ROOT="$TMP/och-platform-no-booking-bundle"
if [[ ! -d "$BUNDLE_ROOT" ]]; then
  found_roots="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  if [[ "$found_roots" == "1" ]]; then
    BUNDLE_ROOT="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
  else
    echo "ERROR: could not find unique extracted bundle root under $TMP" >&2
    find "$TMP" -mindepth 1 -maxdepth 2 -print >&2
    exit 1
  fi
fi
echo "Bundle root: $BUNDLE_ROOT"

_list_with_excludes() {
  local base="$1"
  cd "$base"
  find . -type f -print | while IFS= read -r p; do
    rel="${p#./}"
    no_booking_should_skip "$rel" && continue
    local skip=0 b
    for b in "${BUNDLE_ONLY[@]}"; do
      [[ "$rel" == "$b" ]] && skip=1 && break
    done
    [[ "$skip" -eq 1 ]] && continue
    echo "$rel"
  done | sort
}

echo "== Listing source files with package exclusions =="
_list_with_excludes "$ROOT" >"$SOURCE_LIST"

echo "== Listing archive files (bundle-only metadata stripped) =="
_list_with_excludes "$BUNDLE_ROOT" >"$BUNDLE_LIST"

python3 - "$ROOT" "$BUNDLE_ROOT" "$SOURCE_LIST" "$BUNDLE_LIST" "$REPORT" "$MISSING_REPORT" "$EXTRA_REPORT" "$MODE" <<'PY'
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

repo_root = Path(sys.argv[1])
bundle_root = Path(sys.argv[2])
source_list_path = Path(sys.argv[3])
bundle_list_path = Path(sys.argv[4])
report_path = Path(sys.argv[5])
missing_report_path = Path(sys.argv[6])
extra_report_path = Path(sys.argv[7])
mode = sys.argv[8]

source_files = [line.strip() for line in source_list_path.read_text().splitlines() if line.strip()]
bundle_files = [line.strip() for line in bundle_list_path.read_text().splitlines() if line.strip()]

source_set = set(source_files)
bundle_set = set(bundle_files)

missing = sorted(source_set - bundle_set)
extra = sorted(bundle_set - source_set)

missing_report_path.write_text("\n".join(missing) + ("\n" if missing else ""))
extra_report_path.write_text("\n".join(extra) + ("\n" if extra else ""))


def folders_for(path: str) -> list[str]:
    parts = path.split("/")[:-1]
    if not parts:
        return ["."]
    if mode == "top":
        return [parts[0]]
    folders = ["."]
    for i in range(1, len(parts) + 1):
        folders.append("/".join(parts[:i]))
    return folders


def summarize(root: Path, files: list[str]) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = defaultdict(lambda: {"files": 0, "bytes": 0})
    for rel in files:
        full = root / rel
        if not full.is_file():
            continue
        size = full.stat().st_size
        for folder in folders_for(rel):
            summary[folder]["files"] += 1
            summary[folder]["bytes"] += size
    return summary


source_summary = summarize(repo_root, source_files)
bundle_summary = summarize(bundle_root, bundle_files)

folders = sorted(set(source_summary) | set(bundle_summary))

lines: list[str] = []
lines.append(f"# mode={mode} — folder file/byte parity (source vs extracted bundle)")
lines.append("folder\tsource_files\tbundle_files\tsource_bytes\tbundle_bytes\tstatus")

# Bundle applies intentional text patches (record-platform / no-booking); bytes may differ.
PATCHED_IN_BUNDLE = frozenset({
    "scripts/bootstrap-all-dbs.sh",
    "infra/k8s/base/kustomization.yaml",
    ".github/workflows/ci.yml",
    "package.json",
})

failed = False
mismatched_folders: list[str] = []
byte_warn_folders: list[str] = []
for folder in folders:
    sf = source_summary.get(folder, {}).get("files", 0)
    bf = bundle_summary.get(folder, {}).get("files", 0)
    sb = source_summary.get(folder, {}).get("bytes", 0)
    bb = bundle_summary.get(folder, {}).get("bytes", 0)

    if sf != bf:
        status = "MISMATCH_FILES"
        failed = True
        mismatched_folders.append(folder)
    elif sb != bb:
        status = "WARN_BYTES"
        byte_warn_folders.append(folder)
    else:
        status = "OK"

    lines.append(f"{folder}\t{sf}\t{bf}\t{sb}\t{bb}\t{status}")

lines.append("")
lines.append("== service-level quick view ==")
lines.append("service\tsource_files\tbundle_files\tsource_bytes\tbundle_bytes\tstatus")

services = sorted({
    p.split("/", 2)[1]
    for p in source_files + bundle_files
    if p.startswith("services/") and len(p.split("/")) >= 3
})

for service in services:
    folder = f"services/{service}"
    sf = source_summary.get(folder, {}).get("files", 0)
    bf = bundle_summary.get(folder, {}).get("files", 0)
    sb = source_summary.get(folder, {}).get("bytes", 0)
    bb = bundle_summary.get(folder, {}).get("bytes", 0)
    if sf != bf:
        status = "MISMATCH_FILES"
        failed = True
    elif sb != bb:
        status = "WARN_BYTES"
    else:
        status = "OK"
    lines.append(f"{service}\t{sf}\t{bf}\t{sb}\t{bb}\t{status}")

lines.append("")
lines.append("== scripts/coverage (must be present) ==")
for label, paths in [("source", source_files), ("bundle", bundle_files)]:
    n = sum(1 for p in paths if p.startswith("scripts/coverage/"))
    lines.append(f"scripts/coverage/{label}\t{n}")

lines.append("")
lines.append(f"source_total_files\t{len(source_files)}")
lines.append(f"bundle_total_files\t{len(bundle_files)}")
lines.append(f"missing_files\t{len(missing)}")
lines.append(f"extra_files\t{len(extra)}")
lines.append(f"mismatched_folders\t{len(mismatched_folders)}")
lines.append(f"byte_warn_folders\t{len(byte_warn_folders)}")
lines.append("patched_in_bundle\t" + ", ".join(sorted(PATCHED_IN_BUNDLE)))
if mismatched_folders:
    lines.append("mismatched_folder_sample\t" + ", ".join(mismatched_folders[:20]))
if byte_warn_folders:
    lines.append("byte_warn_sample\t" + ", ".join(byte_warn_folders[:20]))

report_path.write_text("\n".join(lines) + "\n")
print(report_path.read_text())

if missing:
    print("== Missing files sample ==", file=sys.stderr)
    for item in missing[:50]:
        print(item, file=sys.stderr)

if extra:
    print("== Extra files sample ==", file=sys.stderr)
    for item in extra[:50]:
        print(item, file=sys.stderr)

if failed or missing or extra:
    raise SystemExit("FAIL: bundle folder parity mismatch")

print("PASS: bundle folder parity verifier passed")
PY
