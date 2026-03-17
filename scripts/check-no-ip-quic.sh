#!/usr/bin/env bash
# Enforce QUIC hostname invariant: no curl --http3 to raw IP URLs.
# QUIC/HTTP/3 must use hostnames (e.g. record.local) with --resolve so SNI and certs match.
# CI: run this script; exit 1 if any script uses e.g. https://192.168.64.240 or https://127.0.0.1 with HTTP/3.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

# Match lines that have HTTP/3 flag and https://<IP> but do NOT use --resolve (correct pattern).
# Exclude: lines containing --resolve (documentation or correct usage); 127.0.0.1 (localhost inside VM).
# Use find + grep for portability (BSD grep on macOS has no --include).
candidates=$(find scripts -type f -name '*.sh' 2>/dev/null | xargs grep -n -E -- '--http3(-only)?' 2>/dev/null | grep -E 'https://[0-9][0-9.]*[0-9]' || true)
offenders=""
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  # Skip if line uses --resolve (correct pattern) or is 127.0.0.1 only (localhost diagnostic)
  if echo "$line" | grep -q -- '--resolve'; then
    continue
  fi
  if echo "$line" | grep -qE 'https://127\.0\.0\.1'; then
    continue
  fi
  offenders="${offenders:+$offenders$'\n'}$line"
done <<< "$candidates"
if [[ -n "$offenders" ]]; then
  echo "QUIC invariant violation: HTTP/3 must not use raw IP URLs (without --resolve). Use hostname (e.g. record.local) with --resolve." >&2
  echo "$offenders" >&2
  echo "Fix: use https://record.local and --resolve record.local:443:<IP>." >&2
  exit 1
fi
echo "OK: No IP-based HTTP/3 usage found (QUIC hostname invariant)."
exit 0
