#!/usr/bin/env bash
# T15.2C — Idempotent RAG reindex: analytics-normalized docs → python_ai corpus.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ARGS=("$@")
if [[ ${#ARGS[@]} -eq 0 ]]; then
  echo "Usage: $0 --all | --source <records|listings|offers|auctions|notifications|messages> [--user <id>] [--dry-run]" >&2
  exit 2
fi

echo "=== RP AI RAG reindex (T15.2C) ==="
node "$SCRIPT_DIR/rp-ai-rag-reindex.mjs" "${ARGS[@]}"
