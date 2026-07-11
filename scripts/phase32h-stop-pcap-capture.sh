#!/usr/bin/env bash
# Phase 32H — stop PCAP capture and write SHA-256 manifest under /tmp only.
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
PCAP_DIR="$OUT/pcap"
STATUS="$PCAP_DIR/capture-status.json"
MANIFEST="$PCAP_DIR/pcap-sha256-manifest.json"

if [[ -f "$STATUS" ]]; then
  PID="$(python3 -c "import json;print(json.load(open('$STATUS')).get('pid',''))" 2>/dev/null || true)"
  if [[ -n "$PID" ]]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  python3 -c "import json;d=json.load(open('$STATUS'));d['status']='STOPPED';d['stopped_at']=__import__('datetime').datetime.utcnow().isoformat()+'Z';json.dump(d,open('$STATUS','w'),indent=2)"
fi

python3 - <<'PY' "$PCAP_DIR" "$MANIFEST"
import hashlib, json, pathlib, sys
pcap_dir, manifest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
rows = []
for p in sorted(pcap_dir.glob("*.pcap*")):
    if p.name.endswith(".json"):
        continue
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    rows.append({"file": str(p), "bytes": p.stat().st_size, "sha256": h.hexdigest()})
manifest.write_text(json.dumps({"files": rows, "count": len(rows)}, indent=2) + "\n")
print(json.dumps({"manifest": str(manifest), "count": len(rows)}))
PY
