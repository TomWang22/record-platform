#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-bench_export.csv}"
OUTDIR="${2:-bench_plots}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"

# Check if matplotlib is installed
if ! python3 -c "import matplotlib" 2>/dev/null; then
  echo "❌ matplotlib is not installed."
  echo ""
  echo "Installing matplotlib..."
  if command -v pip3 >/dev/null 2>&1; then
    pip3 install matplotlib || {
      echo "⚠️  pip3 install failed. Trying with --user flag..."
      pip3 install --user matplotlib || {
        echo "❌ Failed to install matplotlib automatically."
        echo ""
        echo "Please install it manually:"
        echo "  pip3 install matplotlib"
        exit 1
      }
    }
    echo "✅ matplotlib installed successfully!"
  else
    echo "❌ pip3 not found. Please install matplotlib manually:"
    echo "  pip3 install matplotlib"
    exit 1
  fi
fi

python3 "$script_dir/plot-bench.py" --input "$REPO_ROOT/$INPUT" --outdir "$REPO_ROOT/$OUTDIR"
echo "📊 Plots are in: $REPO_ROOT/$OUTDIR"

