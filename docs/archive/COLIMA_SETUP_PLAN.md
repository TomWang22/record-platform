# Colima Setup Plan and Build Fixes

**Date**: January 8, 2026  
**Status**: Colima running, buildx configured, need to fix builds and free disk space

## Current Status

### ✅ Working
- **Colima**: Running with Docker runtime
- **Docker connectivity**: Accessible via `unix://${HOME}/.colima/default/docker.sock`
- **buildx**: `colima-builder` configured and running
  - Supports: `linux/amd64`, `linux/arm64`, `linux/386`
  - BuildKit version: v0.26.2
- **Kind cluster**: h3 cluster exists
- **Postgres databases**: 8 databases running via Docker Compose
- **Data**: 2,438,102 records restored

### ⚠️ Issues
- **Disk space**: 75% full (4GB free) - causing "no space left on device" errors
- **Docker Desktop Docker.raw**: 256GB still present (can be removed since we're using Colima)
- **Build failures**: "no space left on device" during builds
- **Old buildx builders**: `multi-platform` and `desktop-linux` pointing to non-existent Docker Desktop

## Immediate Actions

### 1. Free Up Disk Space (CRITICAL)

**Remove Docker Desktop Docker.raw** (256GB):
```bash
# Since we're using Colima, Docker Desktop's Docker.raw can be safely removed
# This will free up 256GB of disk space

# Option A: Remove just Docker.raw (safest)
rm ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw

# Option B: Remove entire Docker Desktop directory (if not using Docker Desktop)
# WARNING: This removes all Docker Desktop data
# rm -rf ~/Library/Containers/com.docker.docker
```

**Clean up old buildx builders**:
```bash
# Remove old builders pointing to desktop-linux
docker buildx rm multi-platform || true
docker buildx rm desktop-linux || true
```

**Clean up Colima build cache** (if needed):
```bash
# Clean old build cache
docker builder prune -af --filter "until=168h"
```

### 2. Fix Build Configuration

**Use correct buildx builder**:
```bash
# Ensure we're using colima-builder
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
docker buildx use colima-builder
```

**Update build-and-load.sh**:
- Use `colima-builder` instead of `multi-platform`
- Ensure `DOCKER_HOST` is set correctly
- Add disk space checks before building

### 3. Test Build Process

**Build one service to verify**:
```bash
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

# Test build api-gateway
docker buildx build --platform linux/amd64 --load \
  -f services/api-gateway/Dockerfile \
  -t api-gateway:dev .

# Verify image exists
docker images | grep api-gateway:dev

# Load into Kind
kind load docker-image api-gateway:dev --name h3
```

## Build Process Fixes

### Issue: "no space left on device"
**Root cause**: Disk 75% full (4GB free)  
**Solution**: Remove Docker Desktop Docker.raw (256GB)

### Issue: Buildx pointing to desktop-linux
**Root cause**: Old builders configured for Docker Desktop  
**Solution**: Use `colima-builder` explicitly

### Issue: Build context errors
**Root cause**: Some Dockerfiles expect to be run from service directory  
**Solution**: Build from repo root with correct context:
```bash
docker buildx build --platform linux/amd64 --load \
  -f services/<service>/Dockerfile \
  -t <service>:dev .
```

## Colima Configuration

### Current Configuration
- **Runtime**: Docker (not containerd - we switched back)
- **CPU**: 8 cores
- **Memory**: 12GB
- **Disk**: 200GB
- **Kubernetes**: Enabled (but we use Kind cluster separately)

### Docker Context
```bash
# Set Docker context to Colima
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
# OR
docker context use colima
```

### buildx Configuration
```bash
# Use colima-builder for all builds
docker buildx use colima-builder

# Verify builder supports linux/amd64
docker buildx inspect colima-builder
```

## Docker Desktop Status

### Can Docker Desktop Be Opened?
**Answer**: Yes, but we don't need it anymore.

**To test**:
```bash
open -a Docker
# Wait a few seconds
ps aux | grep -i "Docker Desktop" | grep -v grep
```

**Recommendation**: 
- Keep Docker Desktop installed (in case we need it)
- But don't use it (we're using Colima)
- Remove Docker.raw to free up 256GB

## Build Script Updates Needed

### scripts/build-and-load.sh
1. **Set DOCKER_HOST explicitly**:
   ```bash
   export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
   ```

2. **Use colima-builder**:
   ```bash
   docker buildx use colima-builder
   ```

3. **Add disk space check**:
   ```bash
   # Check disk space before building
   DISK_FREE=$(df -h / | tail -1 | awk '{print $4}')
   if [[ "$DISK_FREE" < "10G" ]]; then
     echo "⚠️  Warning: Low disk space ($DISK_FREE free)"
     echo "   Consider removing Docker Desktop Docker.raw to free up 256GB"
   fi
   ```

4. **Build from repo root**:
   ```bash
   # Build from repo root with correct context
   docker buildx build --platform linux/amd64 --load \
     -f services/<service>/Dockerfile \
     -t <service>:dev .
   ```

## Next Steps

1. ✅ **Free up disk space**: Remove Docker Desktop Docker.raw (256GB)
2. ✅ **Clean up old buildx builders**: Remove multi-platform and desktop-linux
3. ✅ **Update build script**: Use colima-builder and set DOCKER_HOST
4. ✅ **Test build**: Build one service to verify
5. ✅ **Build all services**: Run build-and-load.sh
6. ✅ **Load into Kind**: Verify images load correctly
7. ✅ **Deploy services**: Verify pods start correctly

## Verification Checklist

- [ ] Disk space > 20GB free (after removing Docker.raw)
- [ ] Colima running: `colima status`
- [ ] Docker accessible: `docker ps`
- [ ] buildx configured: `docker buildx ls`
- [ ] One service builds successfully
- [ ] Image loads into Kind: `kind load docker-image <service>:dev --name h3`
- [ ] Pod starts correctly: `kubectl get pods -n record-platform`

## Related Files

- `scripts/setup-colima-containerd.sh` - Colima setup script
- `scripts/build-and-load.sh` - Build and load script (needs updates)
- `docs/adr/001-migrate-docker-desktop-to-colima-containerd.md` - ADR for migration
- `COLIMA_MIGRATION_STATUS.md` - Migration status

---

**Last Updated**: January 8, 2026  
**Author**: Tom
