# Colima/k3s Fixes Summary

## Problem

k3s API server was not becoming ready after Colima restart, causing:
- All `kubectl` commands failing with "connection refused" or "connection reset by peer"
- Test suites unable to run
- Services unable to be deployed or checked

## Solution

Created comprehensive diagnostic and fix scripts to ensure Colima and k3s are properly started and ready.

## Files Created

### 1. `scripts/ensure-colima-k3s-ready.sh` (9.8KB)
**Purpose**: Comprehensive diagnostics and fixes for Colima/k3s startup

**What it does**:
1. ✅ Verifies Colima is running (starts if not)
2. ✅ Checks k3s service status inside Colima VM
3. ✅ Reviews k3s logs for startup errors
4. ✅ Checks if k3s is listening on port 6443
5. ✅ Attempts to start/restart k3s if needed
6. ✅ Waits for k3s API server to be ready (up to 5 minutes, configurable)
7. ✅ Provides detailed diagnostics if k3s won't start
8. ✅ Verifies cluster is operational

**Usage**:
```bash
./scripts/ensure-colima-k3s-ready.sh
MAX_WAIT=300 ./scripts/ensure-colima-k3s-ready.sh  # Wait up to 5 minutes
```

### 2. `scripts/continue-after-k3s-ready.sh` (Updated, 5.2KB)
**Purpose**: Continue with service scaling and verification after k3s is ready

**What it does**:
1. ✅ Waits for k3s API server with better diagnostics
2. ✅ Attempts to fix kubeconfig if local kubectl fails
3. ✅ Checks k3s service status periodically
4. ✅ Scales all services to 1 replica
5. ✅ Cleans up old ReplicaSets
6. ✅ Checks pod status
7. ✅ Verifies strict TLS configuration

**Improvements**:
- Better error handling
- Automatic k3s service restart if inactive
- kubeconfig fixes
- More diagnostic output

### 3. `scripts/K3S_STARTUP_DIAGNOSTICS.md` (5.3KB)
**Purpose**: Comprehensive troubleshooting guide

**Contents**:
- Root cause analysis
- Manual diagnostic steps
- Common fixes
- Verification procedures
- Troubleshooting checklist

### 4. `scripts/QUICK_START_COLIMA_K3S.md` (Quick Reference)
**Purpose**: Quick reference for common operations

**Contents**:
- Quick check commands
- Automated fix option
- Manual quick fixes
- Common issues table

### 5. `scripts/run-platform-wide-test-suite.sh` (Updated)
**Changes**:
- Now uses `ensure-colima-k3s-ready.sh` for pre-flight checks
- Better error handling if k3s isn't ready
- More informative error messages

## How to Use

### Step 1: Ensure Colima and k3s are Ready

```bash
./scripts/ensure-colima-k3s-ready.sh
```

This will:
- Check everything
- Fix common issues automatically
- Wait for k3s to be ready
- Provide diagnostics if it fails

### Step 2: Continue with Services

```bash
./scripts/continue-after-k3s-ready.sh
```

This will:
- Scale services to 1 replica
- Clean up old resources
- Verify strict TLS configuration

### Step 3: Run Tests

```bash
# Full test suite
RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh

# Or platform-wide tests
./scripts/run-platform-wide-test-suite.sh
```

## Diagnostic Features

The `ensure-colima-k3s-ready.sh` script checks:

1. **Colima Status**
   - Is Colima running?
   - What are the resources (CPU, memory, disk)?

2. **k3s Service Status**
   - Is k3s systemd service active?
   - Is k3s process running?
   - What are the service errors?

3. **k3s Logs**
   - Recent startup errors
   - Port binding issues
   - Resource constraint errors

4. **Port 6443**
   - Is k3s listening inside Colima VM?
   - Is port accessible from host?

5. **kubeconfig**
   - Is context set correctly?
   - Is server address correct (127.0.0.1:6443)?

6. **API Server Readiness**
   - Can we run `kubectl get nodes`?
   - Is API server responding?

## Automatic Fixes

The script attempts to fix:

1. **k3s Service Not Started**
   - Automatically runs `systemctl start k3s`
   - Checks if it started successfully

2. **k3s Service Inactive**
   - Automatically restarts k3s every 30 seconds if inactive
   - Monitors service status

3. **kubeconfig Issues**
   - Fixes server address to 127.0.0.1:6443
   - Switches to Colima context

4. **Colima Not Running**
   - Attempts to start Colima with recommended resources

## Expected Behavior

### Normal Startup (2-3 minutes)
1. Colima VM boots: 10-30s
2. Docker starts: 5-10s
3. k3s service starts: 30-90s
4. k3s API server ready: 60-180s total

### With Fixes (3-5 minutes)
If k3s needs to be restarted:
1. Diagnostic checks: 10-20s
2. k3s restart: 30-60s
3. API server ready: 60-180s after restart

## Troubleshooting

If `ensure-colima-k3s-ready.sh` fails:

1. **Check the output** - It provides detailed diagnostics
2. **Review k3s logs**: `colima ssh -- sudo journalctl -u k3s -n 100`
3. **Check k3s service**: `colima ssh -- sudo systemctl status k3s`
4. **Restart Colima**: `colima stop && colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes`

## Integration

All test scripts now use the diagnostic script:

- `run-platform-wide-test-suite.sh` - Uses `ensure-colima-k3s-ready.sh` for pre-flight
- `run-preflight-scale-and-all-suites.sh` - Can use `continue-after-k3s-ready.sh`
- `continue-after-k3s-ready.sh` - Enhanced with better k3s diagnostics

## Next Steps

1. ✅ Diagnostic scripts created
2. ✅ Documentation created
3. ⏳ Test the scripts with your current Colima/k3s setup
4. ⏳ Verify k3s becomes ready
5. ⏳ Run test suites

## Related Files

- `FIXES-APPLIED-SUMMARY.md` - Previous fixes (YAML, TLS, etc.)
- `CURRENT-STATUS-AND-NEXT-STEPS.md` - Current state
- `scripts/COLIMA_K3S_MIGRATION.md` - Migration from Kind to Colima
