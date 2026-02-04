# Quick Start: Colima + k3s

## Quick Check

```bash
# 1. Check Colima status
colima status

# 2. Check k3s API server
kubectl get nodes --request-timeout=10s
```

If both work, you're ready! Skip to "Next Steps".

## If k3s is Not Ready

### Option 1: Automated Fix (Recommended)

```bash
./scripts/ensure-colima-k3s-ready.sh
```

This script will:
- ✅ Check Colima status
- ✅ Diagnose k3s issues
- ✅ Attempt to fix problems
- ✅ Wait for k3s to be ready (up to 5 minutes)

### Option 2: Manual Quick Fixes

```bash
# 1. Start k3s service
colima ssh -- sudo systemctl start k3s

# 2. Wait 30 seconds
sleep 30

# 3. Check if ready
kubectl get nodes --request-timeout=10s
```

### Option 3: Restart Colima (If k3s won't start)

```bash
colima stop
colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes
```

Wait 2-3 minutes, then:
```bash
kubectl get nodes --request-timeout=10s
```

## Next Steps

Once k3s is ready:

```bash
# 1. Scale services and verify configuration
./scripts/continue-after-k3s-ready.sh

# 2. Run test suite
RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh

# 3. Or run platform-wide tests
./scripts/run-platform-wide-test-suite.sh
```

## Troubleshooting

See `scripts/K3S_STARTUP_DIAGNOSTICS.md` for detailed diagnostics.

## Common Issues

| Issue | Quick Fix |
|-------|-----------|
| `connection refused` | `colima ssh -- sudo systemctl start k3s` |
| `connection reset by peer` | Wait 30-60s, then retry |
| k3s service inactive | `colima ssh -- sudo systemctl restart k3s` |
| Port 6443 not accessible | Check port forwarding: `nc -z 127.0.0.1 6443` |
| Wrong context | `kubectl config use-context colima` |
