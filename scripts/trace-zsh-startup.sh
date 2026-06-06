#!/usr/bin/env zsh
# Find what slows down interactive zsh startup.
# Usage: ./scripts/trace-zsh-startup.sh
# Then: time zsh -i -c exit  (measure after fixing)
#
# Run with -x (trace) and -v (verbose), then inspect the log for long gaps.
# Slow culprits are often: nvm, kind get kubeconfig, conda, oh-my-zsh, plugins.

set -e
LOG="${ZSH_TRACE_LOG:-/tmp/zsh-startup-trace-$(date +%Y%m%d-%H%M%S).log}"
echo "Tracing interactive zsh startup to: $LOG"
echo "  (Look for long gaps between lines; those are the slow parts)"
echo ""
zsh -xv -i -c exit 2>&1 | tee "$LOG"
echo ""
echo "Done. Log: $LOG"
echo "Measure startup time: time zsh -i -c exit"
