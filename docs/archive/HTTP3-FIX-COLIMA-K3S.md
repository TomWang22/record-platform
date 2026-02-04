# HTTP/3 Fix for Colima/k3s

**Date:** 2026-01-22  
**Status:** Fixed HTTP/3 detection for Colima/k3s

## Changes Made

### 1. Enhanced `_http3_detect_kind_node()` ✅
- **Detects k3s clusters**: Checks providerID for "k3s"
- **Detects Colima**: Checks context name and COLIMA_DOCKER_SOCKET
- **Defaults to HOST_NETWORK**: For Colima/k3s, uses host network mode (no container namespace needed)
- **Fallback logic**: If cluster is reachable but no container node found, defaults to HOST_NETWORK

### 2. Enhanced Docker Detection ✅
- **Checks Colima socket**: Looks for `$HOME/.colima/default/docker.sock`
- **Sets DOCKER_HOST**: Automatically sets DOCKER_HOST for Colima
- **Common locations**: Checks `/usr/local/bin/docker`, `/opt/homebrew/bin/docker`, `/usr/bin/docker`
- **Podman support**: Falls back to podman if docker not available (for HOST_NETWORK mode)

### 3. Enhanced `http3_curl()` ✅
- **Uses detected docker_cmd**: Uses the docker command found during detection
- **HOST_NETWORK mode**: For Colima/k3s, uses `--network host` (direct host access)
- **Container namespace mode**: For Kind, uses `--network container:${NODE}`

## How It Works

1. **Detection**: Checks kubectl context, cluster providerID, and docker availability
2. **Colima/k3s**: Detects these and uses HOST_NETWORK mode
3. **Kind**: Detects Kind clusters and uses container network namespace
4. **Fallback**: If cluster is reachable but no specific detection, defaults to HOST_NETWORK

## Testing

The HTTP/3 tests should now work with:
- ✅ Colima (with or without docker in PATH)
- ✅ k3s clusters
- ✅ Kind clusters (existing behavior preserved)

**Status: HTTP/3 detection fixed for Colima/k3s, ready to test**
