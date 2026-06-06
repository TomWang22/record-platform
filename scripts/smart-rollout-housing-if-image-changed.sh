#!/usr/bin/env bash
# Deprecated wrapper — use smart-rollout-rp-if-image-changed.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/smart-rollout-rp-if-image-changed.sh" "$@"
