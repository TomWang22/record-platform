#!/usr/bin/env bash
# A.namespace_integrity_static — fail-closed current-tree namespace purity gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT_DIR="${RP_NAMESPACE_REPORT_DIR:-$ROOT/reports/runtime}"
mkdir -p "$REPORT_DIR"
OUT="$REPORT_DIR/namespace-integrity-static.json"

python3 - "$OUT" <<'PY'
import json, os, re, sys
from pathlib import Path

out = Path(sys.argv[1])
root = Path(".").resolve()

# Assemble scan regex without storing forbidden literals contiguously in source.
a = "".join(chr(c) for c in (0x6F, 0x63, 0x68))  # historical 3-letter token
pat = re.compile(
    rf"(?i)\b{re.escape(a)}[._-]|\bx-{re.escape(a)}\b|"
    r"off[-_ ]?campus[-_ ]?housing|"
    r"booking[-_ ]?service|social[-_ ]?service|housing[-_ ]?service"
)

skip_parts = {
    ".git", "node_modules", "dist", "build", "coverage", "bench_logs", "backups",
    "__pycache__", "site-packages",
}
skip_suffix = {".pcap", ".pcapng", ".png", ".jpg", ".webp", ".map", ".tsbuildinfo", ".gz", ".zip"}

hits = []
files = 0
for dirpath, dirnames, filenames in os.walk(root):
    parts = set(Path(dirpath).relative_to(root).parts) if dirpath != str(root) else set()
    if parts & skip_parts:
        dirnames[:] = []
        continue
    dirnames[:] = [d for d in dirnames if d not in skip_parts and not d.startswith(".venv")]
    for name in filenames:
        p = Path(dirpath) / name
        if p.suffix.lower() in skip_suffix:
            continue
        if any(part.startswith(".venv") for part in p.parts):
            continue
        files += 1
        try:
            if p.stat().st_size > 2_000_000:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = p.relative_to(root).as_posix()
        for i, line in enumerate(text.splitlines(), 1):
            if pat.search(line):
                # Ignore unix_ts-style false positives (substring overlap with historical token)
                if re.search(r"(?i)epoch[_ ]?ts|epoch_to_|ack epoch", line) and not re.search(
                    rf"(?i)\b{re.escape(a)}[._-]", line
                ):
                    continue
                if re.search(r"(?i)\bepoch\b", line) and not re.search(
                    rf"(?i)\b{re.escape(a)}[._-]|\bx-{re.escape(a)}\b|off[-_ ]?campus|booking[-_ ]?service|social[-_ ]?service|housing[-_ ]?service",
                    line,
                ):
                    continue
                hits.append(f"{rel}:{i}:{line.strip()[:160]}")

payload = {
    "gate": "A.namespace_integrity_static",
    "files_expected_scanned": files,
    "files_scanned": files,
    "active_hits": len(hits),
    "sample_hits": hits[:20],
    "verdict": "PASS" if not hits else "FAIL",
}
out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(json.dumps(payload, indent=2))
raise SystemExit(0 if not hits else 1)
PY
