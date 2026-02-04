# Root Cause: k3s Crashing (Exit Status 3)

## Problem

**k3s service keeps crashing with `exit status 3`**
- k3s starts but then crashes
- Service shows "activating (start)" - systemd keeps trying to restart it
- API server becomes unavailable intermittently

## Root Cause

From investigation:
- k3s is crashing during startup
- Fatal error: `time="..." level=fatal msg="exit status 3"`
- Not an OOM issue (6.5Gi memory available)
- Likely database corruption or configuration issue in k3s data directory

## Solution Applied

1. **Reset k3s cluster**:
   ```bash
   colima kubernetes reset
   ```

2. **Start fresh**:
   ```bash
   colima kubernetes start
   ```

3. **Wait for full initialization** (45-60 seconds)

4. **Deploy resources after cluster is stable**

## Why This Happens

- **Too many deployments at once** can overwhelm k3s during initialization
- **Database corruption** from previous failed starts
- **Configuration conflicts** from partial deployments

## Prevention

1. **Start cluster first**, wait for it to stabilize (60+ seconds)
2. **Deploy resources gradually** - don't deploy everything at once
3. **Monitor k3s logs**: `colima ssh -- sudo journalctl -u k3s -f`
4. **Reset if unstable**: `colima kubernetes reset` when k3s keeps crashing

## Alternative: Use Kind Cluster

If Colima k3s continues to be unstable:
- Consider using Kind cluster instead (more stable for local dev)
- Run: `scripts/bootstrap-platform.sh` to create Kind cluster
