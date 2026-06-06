#!/usr/bin/env bash
# Install and verify diagnostic tools (tcpdump, tshark, netstat, htop, grpcurl).
# Attempts to install missing required tools via brew (macOS) or apt/apk (Linux).
# Optional: strace, valgrind (valgrind often unavailable on macOS ARM).
# Use STRICT=1 to fail if any required tool is missing after install attempts.

set -euo pipefail

REQUIRED_TOOLS=(tcpdump tshark netstat htop grpcurl)
OPTIONAL_TOOLS=(strace valgrind)
STRICT="${STRICT:-0}"
INSTALL="${INSTALL_TOOLING:-1}"

check_tool() {
  local name="$1"
  local optional="${2:-0}"
  if command -v "$name" >/dev/null 2>&1; then
    echo "✅ Tool available: $name"
    return 0
  fi
  if [[ "$optional" == "1" ]]; then
    echo "⚠️  Missing optional tool: $name"
    return 0
  fi
  echo "❌ Missing required tool: $name"
  return 1
}

install_tool() {
  local name="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    case "$name" in
      tcpdump)  brew install tcpdump 2>/dev/null || true ;;
      tshark)   brew install wireshark 2>/dev/null || true ;;
      netstat)  ;; # built-in on macOS
      htop)     brew install htop 2>/dev/null || true ;;
      grpcurl)  brew install grpcurl 2>/dev/null || true ;;
      strace)   brew install strace 2>/dev/null || true ;;
      valgrind) ;; # skip - often fails on macOS ARM
      *)        brew install "$name" 2>/dev/null || true ;;
    esac
  else
    if command -v apk >/dev/null 2>&1; then
      case "$name" in
        tcpdump)  apk add --no-cache tcpdump 2>/dev/null || true ;;
        tshark)   apk add --no-cache tshark 2>/dev/null || true ;;
        netstat)  apk add --no-cache net-tools 2>/dev/null || true ;;
        htop)     apk add --no-cache htop 2>/dev/null || true ;;
        grpcurl)  apk add --no-cache grpcurl 2>/dev/null || true ;;
        *)        apk add --no-cache "$name" 2>/dev/null || true ;;
      esac
    elif command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -qq 2>/dev/null || true
      case "$name" in
        tshark)   sudo apt-get install -y tshark 2>/dev/null || true ;;
        grpcurl)  sudo apt-get install -y grpcurl 2>/dev/null || true ;;
        *)        sudo apt-get install -y "$name" 2>/dev/null || true ;;
      esac
    fi
  fi
}

fail_count=0
for t in "${REQUIRED_TOOLS[@]}"; do
  check_tool "$t" 0 || fail_count=$((fail_count + 1))
done
for t in "${OPTIONAL_TOOLS[@]}"; do
  check_tool "$t" 1 || true
done

if [[ "$INSTALL" == "1" ]] && [[ $fail_count -gt 0 ]]; then
  echo ""
  echo "Attempting to install missing required tools..."
  for t in "${REQUIRED_TOOLS[@]}"; do
    if ! command -v "$t" >/dev/null 2>&1; then
      echo "  Installing $t..."
      install_tool "$t"
    fi
  done
  fail_count=0
  for t in "${REQUIRED_TOOLS[@]}"; do
    check_tool "$t" 0 || fail_count=$((fail_count + 1))
  done
fi

for t in "${OPTIONAL_TOOLS[@]}"; do
  check_tool "$t" 1 || true
done

echo ""
echo "Verifying tooling preflight..."
for t in "${REQUIRED_TOOLS[@]}"; do
  check_tool "$t" 0 || fail_count=$((fail_count + 1))
done
for t in "${OPTIONAL_TOOLS[@]}"; do
  check_tool "$t" 1 || true
done

if [[ $fail_count -gt 0 ]]; then
  echo "❌ Required tooling missing ($fail_count)"
  if [[ "${STRICT}" == "1" ]]; then
    exit 1
  fi
  exit 0
fi
echo "✅ All required tooling preflight OK"
exit 0
