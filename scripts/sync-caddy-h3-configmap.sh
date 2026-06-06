#!/usr/bin/env bash
# Embed repo-root Caddyfile into infra/k8s/caddy-h3-configmap.yaml (audit-rp-caddyfile parity).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CF="$REPO_ROOT/Caddyfile"
OUT="$REPO_ROOT/infra/k8s/caddy-h3-configmap.yaml"

[[ -f "$CF" ]] || { echo "missing $CF" >&2; exit 1; }

python3 - "$CF" "$OUT" <<'PY'
import sys
from pathlib import Path

cf = Path(sys.argv[1]).read_text()
out = Path(sys.argv[2])
header = """# ConfigMap for caddy-h3 (HTTP/2 + HTTP/3) - used by caddy-h3-deploy.yaml
# Canonical edge config for record-platform.test. Keep in sync with repo-root Caddyfile (scripts/sync-caddy-h3-configmap.sh).
apiVersion: v1
kind: ConfigMap
metadata:
  name: caddy-h3
  namespace: ingress-nginx
data:
  Caddyfile: |
"""
body = "".join(f"    {line}\n" for line in cf.splitlines())
out.write_text(header + body)
print(f"✅ synced {out} from {sys.argv[1]} ({len(cf.splitlines())} lines)")
PY
