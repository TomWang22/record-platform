#!/usr/bin/env bash
# Phase 32H — stop PCAP ring-buffer capture.
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
STATUS="$OUT/pcap/capture-status.json"
if [[ -f "$STATUS" ]]; then
  PID=$(python3 -c "import json;print(json.load(open('$STATUS')).get('pid',''))" 2>/dev/null || true)
  if [[ -n "$PID" ]]; then kill "$PID" 2>/dev/null || true; fi
  python3 -c "import json;d=json.load(open('$STATUS'));d['status']='STOPPED';json.dump(d,open('$STATUS','w'),indent=2)"
fi
