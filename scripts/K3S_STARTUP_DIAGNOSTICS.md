# k3s Startup Diagnostics and Fixes

## Problem

After Colima restart, k3s API server may not be ready, causing:
- `kubectl get nodes` fails with "connection refused" or "connection reset by peer"
- All kubectl commands fail
- Services cannot be deployed or checked

## Root Causes

1. **k3s Service Not Started**: k3s systemd service may not have started automatically
2. **Port Not Listening**: k3s may not be listening on port 6443
3. **Port Forwarding Issues**: Colima port forwarding from VM to host may not be working
4. **k3s Startup Errors**: k3s may be failing to start due to resource constraints or configuration issues
5. **kubeconfig Issues**: kubeconfig may point to wrong server or be missing

## Diagnostic Script

Use the comprehensive diagnostic script:

```bash
./scripts/ensure-colima-k3s-ready.sh
```

This script:
1. ✅ Verifies Colima is running
2. ✅ Checks k3s service status inside Colima
3. ✅ Reviews k3s logs for errors
4. ✅ Checks if k3s is listening on port 6443
5. ✅ Attempts to start k3s if needed
6. ✅ Waits for API server to be ready (up to 5 minutes)
7. ✅ Provides actionable fixes if k3s isn't starting

## Manual Diagnostics

### 1. Check Colima Status

```bash
colima status
```

Should show:
- `colima is running`
- `runtime: docker`
- `kubernetes: enabled`

### 2. Check k3s Service Status

```bash
colima ssh -- sudo systemctl status k3s
```

**Expected**: `Active: active (running)`

**If inactive**:
```bash
colima ssh -- sudo systemctl start k3s
colima ssh -- sudo systemctl enable k3s  # Enable on boot
```

### 3. Check k3s Logs

```bash
colima ssh -- sudo journalctl -u k3s --no-pager -n 100
```

**Look for**:
- ✅ `k3s is up and running`
- ✅ `server is ready`
- ❌ `failed to start`
- ❌ `cannot bind`
- ❌ `port.*in use`
- ❌ `address already in use`

### 4. Check k3s Process

```bash
colima ssh -- ps aux | grep k3s
```

Should show `/usr/local/bin/k3s server` process running.

### 5. Check Port 6443

**Inside Colima VM**:
```bash
colima ssh -- sudo netstat -tlnp | grep 6443
# or
colima ssh -- sudo ss -tlnp | grep 6443
```

**From host**:
```bash
nc -z 127.0.0.1 6443 && echo "Port accessible" || echo "Port not accessible"
```

### 6. Check kubeconfig

```bash
kubectl config view --minify
```

Should show:
- `server: https://127.0.0.1:6443`
- Context: `colima`

**If wrong**:
```bash
kubectl config use-context colima
kubectl config set-cluster colima --server=https://127.0.0.1:6443
```

## Common Fixes

### Fix 1: Start k3s Service

```bash
colima ssh -- sudo systemctl start k3s
colima ssh -- sudo systemctl enable k3s
```

Wait 30-60 seconds, then check:
```bash
kubectl get nodes --request-timeout=10s
```

### Fix 2: Restart k3s Service

```bash
colima ssh -- sudo systemctl restart k3s
```

Wait 30-60 seconds for k3s to restart.

### Fix 3: Restart Colima (Nuclear Option)

If k3s won't start:

```bash
colima stop
colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes
```

Wait 2-3 minutes for Colima and k3s to fully start.

### Fix 4: Check Resource Constraints

k3s may fail to start if Colima doesn't have enough resources:

```bash
colima status
```

**Minimum recommended**:
- CPU: 4+ cores
- Memory: 8GB+
- Disk: 50GB+

**Current setup**: 12 CPU, 12GB RAM, 256GB disk (should be sufficient)

### Fix 5: Check for Port Conflicts

```bash
lsof -i :6443
```

If something else is using port 6443, stop it or change Colima's k3s port.

### Fix 6: Reinstall k3s (Last Resort)

If k3s is corrupted:

```bash
colima ssh -- sudo /usr/local/bin/k3s-uninstall.sh
colima stop
colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes
```

## Verification

After fixes, verify k3s is ready:

```bash
# Method 1: kubectl get nodes
kubectl get nodes --request-timeout=10s

# Method 2: via colima ssh
colima ssh -- kubectl get nodes --request-timeout=10s

# Method 3: Check API server version
kubectl version --client=false --request-timeout=10s
```

## Expected Startup Time

- **Colima VM boot**: 10-30 seconds
- **Docker start**: 5-10 seconds
- **k3s service start**: 30-90 seconds
- **k3s API server ready**: 60-180 seconds total

**Total**: Usually 2-3 minutes after `colima start`, but can take up to 5 minutes.

## Troubleshooting Checklist

- [ ] Colima is running (`colima status`)
- [ ] k3s service is active (`colima ssh -- sudo systemctl is-active k3s`)
- [ ] k3s process is running (`colima ssh -- ps aux | grep k3s`)
- [ ] Port 6443 is listening (`colima ssh -- sudo ss -tlnp | grep 6443`)
- [ ] Port 6443 is accessible from host (`nc -z 127.0.0.1 6443`)
- [ ] kubeconfig is correct (`kubectl config view --minify`)
- [ ] Context is set to colima (`kubectl config current-context`)
- [ ] No port conflicts (`lsof -i :6443`)
- [ ] Sufficient resources (`colima status`)

## Next Steps After k3s is Ready

1. **Scale services**:
   ```bash
   ./scripts/continue-after-k3s-ready.sh
   ```

2. **Run test suite**:
   ```bash
   RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh
   ```

3. **Run platform-wide tests**:
   ```bash
   ./scripts/run-platform-wide-test-suite.sh
   ```

## Scripts

- **`scripts/ensure-colima-k3s-ready.sh`**: Comprehensive diagnostics and fixes
- **`scripts/continue-after-k3s-ready.sh`**: Continue after k3s is ready (scale services, verify TLS)

## Related Issues

- **Issue #11**: Strict TLS configuration (from FIXES-APPLIED-SUMMARY.md)
- **k3s API server glitching**: May be related to resource constraints or port forwarding
