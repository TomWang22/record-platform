# Required Tools Installation Guide

**Date:** 2026-01-22  
**Status:** Tools need to be installed for strict TLS and rotation suite

## Required Tools

### 1. mkcert (CRITICAL - for CA and leaf rotation)
- **Purpose**: Generate and manage local CA and leaf certificates for strict TLS
- **Required for**: 
  - CA rotation (`rotation-suite.sh`)
  - Leaf certificate rotation (`rotation-suite.sh`)
  - Strict TLS verification in tests
- **Installation**:
  ```bash
  # macOS (Homebrew)
  brew install mkcert
  
  # Install CA root
  mkcert -install
  ```
- **Verification**:
  ```bash
  mkcert -version
  mkcert -CAROOT  # Should show CA root directory
  ```

### 2. grpcurl (for gRPC tests)
- **Purpose**: Test gRPC services (health checks, authentication, etc.)
- **Required for**: Baseline and enhanced smoke tests (gRPC service testing)
- **Installation**:
  ```bash
  # macOS (Homebrew)
  brew install grpcurl
  
  # Or via Go
  go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest
  ```
- **Verification**:
  ```bash
  grpcurl -version
  ```

### 3. kubectl (for Kubernetes cluster access)
- **Purpose**: Access Kubernetes cluster, manage pods, services, secrets
- **Required for**: All test scripts
- **Installation**:
  ```bash
  # macOS (Homebrew)
  brew install kubectl
  
  # Or download from Kubernetes releases
  ```
- **Verification**:
  ```bash
  kubectl version --client
  kubectl cluster-info
  ```

### 4. docker (for HTTP/3 tests)
- **Purpose**: Run HTTP/3 curl container for QUIC/HTTP/3 testing
- **Required for**: HTTP/3 tests in baseline and enhanced smoke tests
- **Installation**:
  ```bash
  # macOS (Homebrew)
  brew install docker
  
  # Or use Colima (which includes Docker)
  brew install colima
  colima start
  ```
- **Verification**:
  ```bash
  docker --version
  docker ps
  ```

## Installation Script

Run this to install all tools (macOS with Homebrew):

```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install all tools
brew install mkcert grpcurl kubectl docker

# Set up mkcert CA
mkcert -install

# Verify installations
mkcert -version
grpcurl -version
kubectl version --client
docker --version
```

## Current Status

❌ **mkcert**: NOT INSTALLED (CRITICAL - blocks rotation suite)  
❌ **grpcurl**: NOT INSTALLED (blocks gRPC tests)  
❌ **kubectl**: NOT IN PATH (may be installed but not accessible)  
✅ **docker**: Available (via Colima socket)

## Next Steps

1. Install mkcert and set up CA root (CRITICAL for rotation suite)
2. Install grpcurl (for gRPC tests)
3. Ensure kubectl is in PATH (or add to PATH)
4. Re-run rotation suite once tools are installed

**Status: Tools need to be installed before running rotation suite**
