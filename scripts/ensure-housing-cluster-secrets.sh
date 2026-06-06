#!/usr/bin/env bash
# Deprecated name — use ensure-rp-cluster-secrets.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ensure-rp-cluster-secrets.sh" "$@"
