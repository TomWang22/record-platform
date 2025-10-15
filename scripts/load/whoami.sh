#!/usr/bin/env bash
set -euo pipefail
: "${TOKEN:?TOKEN required}"
curl -sfS -H "Authorization: Bearer ${TOKEN}" http://localhost:8080/api/__whoami >/dev/null
echo "whoami ok"