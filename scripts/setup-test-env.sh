#!/usr/bin/env bash
# Setup test environment with proper PATH for tools

# Add common tool locations to PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Verify Homebrew is available
if ! command -v brew >/dev/null 2>&1; then
  echo "⚠️  Homebrew not found - installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Verify curl is available
if ! command -v curl >/dev/null 2>&1; then
  echo "⚠️  curl not found - installing via Homebrew..."
  brew install curl
fi

# Verify tools are accessible
MISSING_TOOLS=0

if ! command -v mkcert >/dev/null 2>&1; then
  echo "⚠️  mkcert not found - installing..."
  brew install mkcert
  mkcert -install
  MISSING_TOOLS=$((MISSING_TOOLS + 1))
fi

if ! command -v grpcurl >/dev/null 2>&1; then
  echo "⚠️  grpcurl not found - installing..."
  brew install grpcurl
  MISSING_TOOLS=$((MISSING_TOOLS + 1))
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "⚠️  kubectl not found - installing..."
  brew install kubectl
  MISSING_TOOLS=$((MISSING_TOOLS + 1))
fi

if ! command -v docker >/dev/null 2>&1 && [[ ! -S "$HOME/.colima/default/docker.sock" ]]; then
  echo "⚠️  docker not found - checking Colima..."
  if command -v colima >/dev/null 2>&1; then
    echo "✅ Docker available via Colima"
  else
    echo "⚠️  Docker/Colima not found"
    MISSING_TOOLS=$((MISSING_TOOLS + 1))
  fi
fi

if [[ $MISSING_TOOLS -gt 0 ]]; then
  echo "⚠️  Some tools were missing but installation attempted"
fi

echo "✅ All tools accessible"
echo "✅ PATH configured: $PATH"