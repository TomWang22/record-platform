# k3s API Server Wedged - Root Cause Analysis

## Critical Finding: k3s API Server Performance Degradation

### Symptoms
- kubectl commands fail with "connection refused" to `127.0.0.1:6443`
- k3s server process is running (PID 8611, uptime 24+ hours)
- API server is timing out on requests
- All Kubernetes operations are unresponsive

### Root Cause
**k3s database (kine) is severely degraded**, causing API server timeouts:

```
E0127 22:23:19.988682    8611 writers.go:136] "Unhandled Error" 
err="apiserver was unable to write a fallback JSON response: http: Handler timeout"

time="2026-01-27T22:23:09-05:00" level=info msg="Slow SQL (started: 2026-01-27 22:23:06.432488601 -0500 EST m=+54420.158074469) 
(total time: 2.112055527s): SELECT * FROM ..."

time="2026-01-27 22:23:12-05:00" level=warning msg="Slow SQL (started: 2026-01-27 22:23:06.616437527 -0500 EST m=+54420.342023437) 
(total time: 5.983318217s): SELECT * FROM ..."
```

### Why This Happens
1. **k3s uses kine (SQLite/PostgreSQL) instead of etcd** for storage
2. **Database queries are taking 2-6+ seconds** instead of milliseconds
3. **API server requests timeout** waiting for database responses
4. **Cascading failures** - all Kubernetes operations become unresponsive

### Contributing Factors
- **Long uptime** (24+ hours) - possible resource accumulation
- **Many pods/volumes** - database queries become slower with more resources
- **No database maintenance** - kine may need compaction/cleanup
- **Resource pressure** - k3s may be running out of memory/CPU

### Impact
- **All kubectl commands fail** - cannot manage cluster
- **Services cannot be checked** - cannot diagnose gRPC connection issues
- **Test suites fail** - cannot verify service health
- **Operational hygiene degraded** - cannot clean up resources

### Solution

#### Immediate Fix: Restart k3s
```bash
# Restart k3s to clear database locks and reset state
colima kubernetes stop
sleep 5
colima kubernetes start
sleep 10

# Verify API server is responsive
kubectl cluster-info
```

#### Long-term Prevention
1. **Regular k3s restarts** - restart k3s daily/weekly to prevent accumulation
2. **Resource cleanup** - regularly clean up completed jobs, old pods
3. **Monitor k3s health** - check for slow SQL warnings in logs
4. **Consider etcd** - for production, consider using full Kubernetes with etcd

### Detection Script
Created `scripts/deep-cluster-health-check.sh` to detect:
- Zombie pods
- Resource usage
- Operational hygiene issues
- k3s performance degradation

### Related Issues
- gRPC connection refused errors are **symptom**, not root cause
- Cannot diagnose auth-service issues because API server is unresponsive
- Test suite failures are cascading from API server unavailability

### Next Steps
1. ✅ Restart k3s to restore API server functionality
2. ✅ Run deep cluster health check after restart
3. ✅ Investigate gRPC connection issues once API server is responsive
4. ✅ Implement regular k3s health monitoring
