#!/usr/bin/env bash
# Compare OCH repo (current branch) vs extracted no-booking bundle: file + byte counts per folder.
# Uses the same exclude rules as package-och-platform-no-booking-bundle.sh.
#
# Usage: bash scripts/check-no-booking-bundle-parity.sh /path/to/och-platform-no-booking-bundle.tar.gz
set -euo pipefail

TARBALL="${1:?usage: $0 /path/to/och-platform-no-booking-bundle.tar.gz}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$REPO_ROOT/reports"
mkdir -p "$REPORT_DIR"

SOURCE_LIST="$REPORT_DIR/no-booking-bundle-source-files.txt"
ARCHIVE_LIST="$REPORT_DIR/no-booking-bundle-archive-files.txt"
PARITY_REPORT="$REPORT_DIR/no-booking-bundle-parity.txt"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

tar -xzf "$TARBALL" -C "$TMP"
BUNDLE_ROOT="$TMP/och-platform-no-booking-bundle"
if [[ ! -d "$BUNDLE_ROOT" ]]; then
  echo "ERROR: expected bundle root not found: $BUNDLE_ROOT" >&2
  exit 1
fi

# shellcheck source=lib/no-booking-bundle-excludes.sh
source "$REPO_ROOT/scripts/lib/no-booking-bundle-excludes.sh"

_list_source_files() {
  cd "$REPO_ROOT"
  find . -type f -print | while IFS= read -r p; do
    no_booking_should_skip "$p" && continue
    echo "${p#./}"
  done | sort
}

_list_archive_files() {
  cd "$BUNDLE_ROOT"
  find . -type f -print | while IFS= read -r p; do
    no_booking_should_skip "$p" && continue
    echo "${p#./}"
  done | sort
}

echo "→ listing source files (excludes applied)…"
_list_source_files >"$SOURCE_LIST"
echo "→ listing archive files…"
_list_archive_files >"$ARCHIVE_LIST"

python3 - "$REPO_ROOT" "$BUNDLE_ROOT" "$SOURCE_LIST" "$ARCHIVE_LIST" "$PARITY_REPORT" <<'PY'
import sys
from pathlib import Path
from collections import defaultdict

repo_root = Path(sys.argv[1])
bundle_root = Path(sys.argv[2])
source_list = Path(sys.argv[3])
archive_list = Path(sys.argv[4])
report_path = Path(sys.argv[5])

BUNDLE_ONLY = frozenset({
    "README_BUNDLE.txt",
    "EXCLUDED.txt",
    "MANIFEST.txt",
    "PORTS_AND_CONFLICTS.txt",
})

source_files = [l.strip() for l in source_list.read_text().splitlines() if l.strip()]
archive_files = [l.strip() for l in archive_list.read_text().splitlines() if l.strip()]
archive_norm = [p for p in archive_files if p not in BUNDLE_ONLY]

source_set = set(source_files)
archive_set = set(archive_norm)

missing = sorted(source_set - archive_set)
extra = sorted(archive_set - source_set)


def top_level(path: str) -> str:
    return path.split("/", 1)[0]


def summarize(root: Path, files: list[str]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = defaultdict(lambda: {"files": 0, "bytes": 0})
    for rel in files:
        p = root / rel
        if not p.is_file():
            continue
        key = top_level(rel)
        out[key]["files"] += 1
        out[key]["bytes"] += p.stat().st_size
    return out

source_summary = summarize(repo_root, source_files)
archive_summary = summarize(bundle_root, archive_norm)

all_keys = sorted(set(source_summary) | set(archive_summary))
lines: list[str] = []
lines.append("top_level\tsource_files\tbundle_files\tsource_bytes\tbundle_bytes\tstatus")

failed = False
for key in all_keys:
    sf = source_summary.get(key, {}).get("files", 0)
    af = archive_summary.get(key, {}).get("files", 0)
    sb = source_summary.get(key, {}).get("bytes", 0)
    ab = archive_summary.get(key, {}).get("bytes", 0)
    status = "OK" if sf == af else "MISMATCH"
    if status != "OK":
        failed = True
    lines.append(f"{key}\t{sf}\t{af}\t{sb}\t{ab}\t{status}")

lines.append("")
lines.append(f"source_total_files\t{len(source_files)}")
lines.append(f"bundle_total_files\t{len(archive_norm)}\t(+ {len(archive_files) - len(archive_norm)} bundle-only metadata)")
lines.append(f"set_equal\t{source_set == archive_set}")

if missing:
    failed = True
    lines.append("")
    lines.append(f"missing_in_bundle ({len(missing)}) — first 40:")
    lines.extend(missing[:40])
if extra:
    failed = True
    lines.append("")
    lines.append(f"extra_in_bundle ({len(extra)}) — first 40:")
    lines.extend(extra[:40])

lines.append("")
lines.append("services/* parity")
lines.append("service\tsource_files\tbundle_files\tstatus")

def service_names(files: list[str]) -> set[str]:
    names: set[str] = set()
    for p in files:
        if p.startswith("services/"):
            parts = p.split("/")
            if len(parts) >= 2:
                names.add(parts[1])
    return names

for service in sorted(service_names(source_files) | service_names(archive_norm)):
    sf = sum(1 for p in source_files if p.startswith(f"services/{service}/"))
    af = sum(1 for p in archive_norm if p.startswith(f"services/{service}/"))
    status = "OK" if sf == af else "MISMATCH"
    if status != "OK":
        failed = True
    lines.append(f"{service}\t{sf}\t{af}\t{status}")

lines.append("")
lines.append("Per top-level folder (source vs bundle file counts)")
lines.append("folder\tsource_files\tbundle_files\tstatus")
top_dirs = [
    ".github", "artifacts", "backups", "certs", "diagrams", "docker", "docs", "infra", "k8s",
    "monitoring", "observability", "proto", "reports", "schemas", "scripts", "services",
    "testd", "tests", "tools", "webapp",
]
for folder in top_dirs:
    sf = sum(1 for p in source_files if p.startswith(f"{folder}/"))
    af = sum(1 for p in archive_norm if p.startswith(f"{folder}/"))
    st = "OK" if sf == af else "MISMATCH"
    if st != "OK":
        failed = True
    lines.append(f"{folder}\t{sf}\t{af}\t{st}")

cov_src = sum(1 for p in source_files if p.startswith("scripts/coverage/"))
cov_arc = sum(1 for p in archive_norm if p.startswith("scripts/coverage/"))
lines.append("")
lines.append("scripts/coverage/ (CI tooling — must be included)")
lines.append(f"source\t{cov_src}\tbundle\t{cov_arc}\tstatus\t{'OK' if cov_src == cov_arc and cov_src > 0 else 'FAIL'}")
if cov_src != cov_arc or cov_src == 0:
    failed = True

lines.append("")
lines.append("See also: reports/no-booking-bundle-folder-counts.txt (raw find vs tar per folder)")

report_path.write_text("\n".join(lines) + "\n")
print(report_path.read_text())

if failed:
    raise SystemExit("FAIL: bundle parity verifier found mismatches")

print("PASS: bundle parity verifier passed")
PY
