#!/usr/bin/env bash
# Install preflight/verify tools on the host (macOS) so we don't need to install them in pods.
# Run once: ./scripts/install-preflight-tools.sh
#
# Installs: Homebrew curl (HTTP/3), htop, tcpdump (often present), tshark (wireshark), netstat (built-in).
# Optional: valgrind (Intel Mac via tap; Apple Silicon not supported by upstream).
# Note: perf and strace are Linux-only; on macOS use Instruments / dtruss or dtrace.
#
# Ensures scripts can use Homebrew curl for HTTP/3 (PATH already set in scripts to /opt/homebrew/bin first).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# Prefer Homebrew
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

if ! command -v brew &>/dev/null; then
  warn "Homebrew not found. Install from https://brew.sh then re-run this script."
  exit 1
fi

say "Installing preflight tools (host — permanent, not in-pod)..."

# --- Homebrew curl (HTTP/3) ---
if brew list curl &>/dev/null 2>&1; then
  ok "Homebrew curl already installed"
else
  brew install curl 2>&1 && ok "Homebrew curl installed" || { warn "brew install curl failed"; exit 1; }
fi
_curl_bin="$(brew --prefix curl 2>/dev/null)/bin/curl"
if [[ -x "${_curl_bin:-}" ]] && "$_curl_bin" --version 2>/dev/null | grep -qi http3; then
  ok "curl supports HTTP/3: $_curl_bin"
else
  warn "curl may not support HTTP/3; scripts use PATH with /opt/homebrew/bin first. Check: $_curl_bin --version | grep -i http3"
fi

# --- htop ---
if command -v htop &>/dev/null; then
  ok "htop already available"
else
  brew install htop 2>&1 && ok "htop installed" || warn "htop install failed (optional)"
fi

# --- tcpdump ---
if command -v tcpdump &>/dev/null; then
  ok "tcpdump already available ($(which tcpdump))"
else
  # macOS often has tcpdump; Linux in CI may need it
  if command -v brew &>/dev/null; then
    brew install libpcap 2>/dev/null || true
  fi
  if command -v tcpdump &>/dev/null; then
    ok "tcpdump available"
  else
    warn "tcpdump not found (optional; install via system or brew)"
  fi
fi

# --- tshark (wireshark) ---
if command -v tshark &>/dev/null; then
  ok "tshark already available"
else
  brew install wireshark 2>&1 && ok "tshark (wireshark) installed" || warn "tshark install failed (optional)"
fi

# --- netstat ---
if command -v netstat &>/dev/null; then
  ok "netstat already available ($(which netstat))"
else
  info "netstat not in PATH (macOS has it under /usr/sbin/netstat; add /usr/sbin to PATH if needed)"
fi

# --- valgrind (optional; Intel Mac only for full support) ---
if [[ "${INSTALL_VALGRIND:-0}" == "1" ]]; then
  if command -v valgrind &>/dev/null; then
    ok "valgrind already available"
  else
    case "$(uname -m)" in
      arm64|aarch64)
        warn "Valgrind on Apple Silicon is not supported by upstream; use Linux VM or set INSTALL_VALGRIND=0"
        ;;
      *)
        if brew tap LouisBrunner/valgrind 2>/dev/null; then
          brew install --HEAD LouisBrunner/valgrind/valgrind 2>&1 && ok "valgrind installed (tap)" || warn "valgrind install failed"
        else
          warn "Valgrind tap failed; install manually: brew tap LouisBrunner/valgrind && brew install --HEAD LouisBrunner/valgrind/valgrind"
        fi
        ;;
    esac
  fi
else
  info "Valgrind skipped (set INSTALL_VALGRIND=1 to install; Intel Mac: use LouisBrunner/valgrind tap)"
fi

# --- perf / strace (Linux-only) ---
info "perf and strace are Linux-only. On macOS use: Instruments (Xcode), dtruss (sudo dtruss), or dtrace."

say "Preflight tools summary"
echo "  curl (HTTP/3): ${_curl_bin:-$(which curl 2>/dev/null || echo 'not found')}"
echo "  htop:          $(which htop 2>/dev/null || echo 'not found')"
echo "  tcpdump:       $(which tcpdump 2>/dev/null || echo 'not found')"
echo "  tshark:        $(which tshark 2>/dev/null || echo 'not found')"
echo "  netstat:       $(which netstat 2>/dev/null || echo 'not found')"
echo "  Scripts PATH:  $SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin (set in run-preflight-scale-and-all-suites.sh and verify-metallb-*.sh)"
ok "Done. Re-run preflight/verify; they will use these host tools (no in-pod install needed)."
