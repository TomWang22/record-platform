# Colima Kubernetes API Server Fix

## Issue
Colima Kubernetes API server not accessible on port 51819.

## Diagnosis Steps

### 1. Check Colima Status
```bash
colima status
colima kubernetes status
```

### 2. Check Port Conflicts
```bash
lsof -i :51819
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

### 3. Check Logs
```bash
colima logs | grep -iE "error|fail|kubernetes|api"
```

## Solution

### Option 1: Reset Kubernetes (Recommended)
```bash
colima kubernetes stop
colima kubernetes reset
colima kubernetes start
```

### Option 2: Restart Colima Entirely
```bash
colima stop
colima start
colima kubernetes start
```

### Option 3: Check Resource Limits
Colima may be running out of resources. Check:
```bash
colima ssh -- df -h /  # Disk usage
colima ssh -- free -h  # Memory usage
```

## Verification

After restart, verify:
```bash
kubectl config use-context colima
kubectl cluster-info
kubectl get nodes
```

## Common Issues

1. **Port Conflict**: Another service using port 51819
2. **Resource Exhaustion**: Colima VM out of memory/disk
3. **Corrupted State**: Kubernetes cluster in bad state
4. **Network Issues**: Docker/Colima network misconfiguration

## Prevention

- Monitor Colima resource usage regularly
- Don't run unnecessary services in Colima
- Use `colima kubernetes reset` if cluster becomes unresponsive
- Consider increasing Colima VM memory if needed: `colima start --cpu 4 --memory 8`
