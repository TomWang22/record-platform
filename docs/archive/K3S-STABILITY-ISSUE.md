# k3s Stability Issue

## Problem
k3s API server keeps crashing and restarting. The cluster becomes accessible briefly (shows 13 Running, 13 Pending pods) but then the API server becomes unavailable again.

## Observed Symptoms
- API server accessible for short periods (10-30 seconds)
- Then becomes unavailable (connection refused)
- k3s service shows "activating" status constantly
- 13 Running pods, 13 Pending pods when accessible
- k3s keeps restarting in a loop

## Potential Causes
1. **Too many open files**: Previous error seen: "Failed to allocate directory watch: Too many open files"
2. **Memory pressure**: Too many pods consuming resources
3. **Resource exhaustion**: CPU/Memory limits being hit
4. **k3s instability**: Known issue with k3s when overwhelmed

## Investigation Needed
1. Check k3s journal logs for crash reasons
2. Check system resources (memory, disk, file descriptors)
3. Review number of pods and their resource usage
4. Consider reducing pod count or increasing limits

## Possible Solutions
1. **Increase file descriptor limits** for k3s
2. **Reduce number of pods** (scale down non-essential services)
3. **Increase Colima VM resources** (memory, CPU)
4. **Switch to different Kubernetes distribution** (Kind, minikube)
5. **Clean up stuck pods** that may be consuming resources

## Current Status
- ⚠️ k3s is unstable and constantly restarting
- ⚠️ Cannot reliably access cluster
- ⚠️ Tests cannot be run until stability is achieved
