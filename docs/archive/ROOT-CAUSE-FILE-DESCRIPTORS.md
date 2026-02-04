# Root Cause: Too Many Open Files (File Descriptor Limit)

## Problem

**k3s keeps crashing with:**
```
inotify_init: too many open files
Failed to start cAdvisor err="inotify_init: too many open files"
```

**Impact:**
- k3s restart counter: **86 restarts**
- Service keeps crashing and restarting
- Node never registers
- Pods can't start because node isn't available

## Root Cause

**File descriptor limits are too low in Colima VM:**
- Default `inotify` limits are insufficient for k3s
- k3s needs to watch many files/directories
- When limit is reached, k3s crashes

## Solution Applied

**Increased file descriptor limits in Colima VM:**
```bash
# Increase inotify limits
sudo sysctl -w fs.inotify.max_user_instances=8192
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.file-max=2097152

# Make permanent
echo "fs.inotify.max_user_instances=8192" >> /etc/sysctl.conf
echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf
echo "fs.file-max=2097152" >> /etc/sysctl.conf
```

**Then restart k3s:**
```bash
colima kubernetes stop
colima kubernetes start
```

## Why This Happens

- k3s uses inotify to watch many files
- Default Linux limits (usually 8192 instances, 524288 watches) may be too low
- With many deployments and containers, limits get exhausted
- Once limit is hit, k3s crashes

## Prevention

These limits should be set in Colima VM startup or k3s configuration:
- `fs.inotify.max_user_instances=8192` or higher
- `fs.inotify.max_user_watches=524288` or higher
- `fs.file-max=2097152` or higher

## Verification

After fix:
- k3s should start without crashing
- Node should register successfully
- Pods should be able to start
- No more "too many open files" errors in logs
