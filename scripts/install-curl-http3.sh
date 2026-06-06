#!/usr/bin/env bash
set -euo pipefail

# Install QUIC-enabled curl on macOS for HTTP/3 testing
# This script installs curl-http3 using the moule/curl-http3 Homebrew tap

echo "=== Installing QUIC-enabled curl (curl-http3) ==="
echo ""

# Check if Homebrew is installed
if ! command -v brew >/dev/null 2>&1; then
  echo "❌ Homebrew not found. Install from https://brew.sh"
  exit 1
fi

# Add the curl-http3 tap
echo "Adding moule/curl-http3 tap..."
brew tap moule/curl-http3 || {
  echo "⚠️  Tap may already exist, continuing..."
}

# Install curl-http3
echo "Installing curl-http3..."
brew install curl-http3 || {
  echo "⚠️  Installation may have failed or curl-http3 already installed"
}

# Verify installation
echo ""
echo "Verifying installation..."
if command -v curl-http3 >/dev/null 2>&1; then
  echo "✅ curl-http3 installed successfully"
  echo ""
  echo "Testing QUIC support..."
  if curl-http3 --http3 https://cloudflare-quic.com -I 2>/dev/null | head -1 | grep -q "HTTP/3"; then
    echo "✅ QUIC support verified!"
    echo ""
    echo "curl-http3 is ready to use for HTTP/3 testing"
  else
    echo "⚠️  QUIC test failed (may be network/firewall issue)"
  fi
else
  echo "❌ curl-http3 not found in PATH"
  echo "   Try: brew link curl-http3"
  exit 1
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Usage:"
echo "  curl-http3 --http3 https://record.local:30443/_caddy/healthz"
echo ""
echo "The rotation suite will automatically detect and use curl-http3"

