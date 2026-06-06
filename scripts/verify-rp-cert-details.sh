#!/usr/bin/env bash
# Alias for print-rp-cert-proof.sh (backward compatible name).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/print-rp-cert-proof.sh" "$@"
