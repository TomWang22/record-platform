# kine/Colima/k3s Timeout Root Cause Fix

**Date**: 2026-01-22  
**Status**: Root cause analysis and fix strategy  
**Focus**: Fix kine/Colima/k3s API server timeouts (the actual bottleneck), not database connection pools

## Problem Statement

The real bottleneck is **kine (k3s database backend) timing out**, causing:
- Colima/k3s API server timeouts
- kubectl commands hanging
- Test suites failing due to API server unavailability
- Cluster becoming unresponsive

**This is NOT a database connection pool issue** - the 8 PostgreSQL databases are externalized (Docker Compose) and already tuned. The issue is kine (SQLite/PostgreSQL backend for k3s) performance.

## Root Cause Analysis

### kine Performance Issues

k3s uses **kine** as its datastore backend. When kine performance degrades:
1. API server queries become slow
2. kubectl commands timeout
3. Cluster operations hang
4. Test suites fail

### Why This Happens

1. **SQLite Backend (Default)**
   - SQLite database grows over time
   - No automatic VACUUM/ANALYZE
   - Index fragmentation
   - Lock contention under load

2. **Resource Accumulation**
   - Old completed jobs not cleaned up
   - Failed pods accumulating
   - ReplicaSets with 0 replicas
   - Event history growing

3. **Colima/k3s Resource Limits**
   - Limited CPU/memory for k3s
   - kine database I/O contention
   - Network latency between Colima VM and host

## Existing Fixes (Already Applied)

### 1. kubectl Shims
- **Location**: `scripts/shims/kubectl`
- **Purpose**: Adds timeouts, Colima 127.0.0.1:6443 fix, fallbacks
- **Status**: ✅ Working but treating symptoms, not root cause

### 2. API Server Ready Checks
- **Location**: `scripts/ensure-api-server-ready.sh`
- **Purpose**: Retries with backoff before running tests
- **Status**: ✅ Working but treating symptoms, not root cause

### 3. Preflight Fixes
- **Location**: `scripts/preflight-fix-kubeconfig.sh`
- **Purpose**: Fixes kubeconfig, verifies cluster reachability
- **Status**: ✅ Working but treating symptoms, not root cause

### 4. kine Optimization Script
- **Location**: `scripts/optimize-k3s-kine-database.sh`
- **Purpose**: VACUUM/ANALYZE/REINDEX for SQLite backend
- **Status**: ✅ Exists but needs to be run proactively

## Root Cause Fixes

### Fix 1: Proactive kine Optimization

**Problem**: kine SQLite database degrades over time without maintenance.

**Solution**: Run kine optimization regularly (weekly or before test suites):

```bash
# Stop k3s (brief downtime ~30 seconds)
colima kubernetes stop

# Optimize kine database
bash scripts/optimize-k3s-kine-database.sh

# Or manually:
colima ssh -- sh -c "
sqlite3 /var/lib/rancher/k3s/server/db/state.db <<'EOFSQL'
ANALYZE;
VACUUM;
REINDEX;
EOFSQL
"

# Restart k3s
colima kubernetes start
```

**Automation**: Add to `run-all-test-suites.sh` pre-flight:

```bash
# Before running test suites, optimize kine if needed
if [[ "${OPTIMIZE_KINE:-0}" == "1" ]]; then
  say "Optimizing kine database..."
  colima kubernetes stop
  bash scripts/optimize-k3s-kine-database.sh
  colima kubernetes start
  sleep 15  # Wait for API server to be ready
fi
```

### Fix 2: Resource Cleanup Before Tests

**Problem**: Accumulated resources (jobs, pods, replicasets) increase kine load.

**Solution**: Clean up before running test suites:

```bash
# Clean up completed jobs
kubectl delete jobs --field-selector status.successful=1 -A 2>/dev/null || true

# Remove old ReplicaSets
kubectl delete rs --field-selector status.replicas=0 -A 2>/dev/null || true

# Clean up old pods
kubectl delete pods --field-selector status.phase=Succeeded -A 2>/dev/null || true
kubectl delete pods --field-selector status.phase=Failed -A 2>/dev/null || true
```

**Automation**: Already exists in `scripts/trim-completed-pods.sh` - ensure it runs before test suites.

### Fix 3: Switch to PostgreSQL Backend (For Production/Heavy Load)

**Problem**: SQLite has limitations under heavy load (locking, concurrency).

**Solution**: Use PostgreSQL backend for kine (better performance, no locking issues):

```bash
# Configure k3s to use PostgreSQL
colima ssh -- sh -c "
cat > /etc/systemd/system/k3s.service.env <<EOF
K3S_DATASTORE_ENDPOINT=postgres://postgres:postgres@host.docker.internal:5433/k3s
EOF
"

# Create k3s database in PostgreSQL
docker exec -it record-platform-postgres-1 psql -U postgres -c "CREATE DATABASE k3s;"

# Restart k3s
colima kubernetes stop
colima kubernetes start
```

**PostgreSQL Optimization** (if using PostgreSQL backend):
```sql
-- Connect to k3s database
\c k3s

-- Vacuum and analyze
VACUUM ANALYZE;

-- Add indexes for kine performance
CREATE INDEX IF NOT EXISTS idx_kine_name ON kine(name);
CREATE INDEX IF NOT EXISTS idx_kine_deleted ON kine(deleted);
CREATE INDEX IF NOT EXISTS idx_kine_created ON kine(created);
```

### Fix 4: Increase Colima Resources

**Problem**: Colima VM may not have enough CPU/memory for k3s under load.

**Solution**: Increase Colima resources:

```bash
# Stop Colima
colima stop

# Edit Colima config (or recreate with more resources)
colima start \
  --cpu 4 \
  --memory 8 \
  --disk 100 \
  --with-kubernetes
```

### Fix 5: Regular k3s Restarts

**Problem**: k3s accumulates state over time, causing performance degradation.

**Solution**: Restart k3s weekly or before heavy test runs:

```bash
# Quick restart (no optimization)
colima kubernetes stop
sleep 5
colima kubernetes start
sleep 15  # Wait for API server
```

## Implementation Plan

### Immediate (Before Next Test Run)

1. **Run kine optimization**:
   ```bash
   colima kubernetes stop
   bash scripts/optimize-k3s-kine-database.sh
   colima kubernetes start
   ```

2. **Clean up resources**:
   ```bash
   bash scripts/trim-completed-pods.sh
   ```

3. **Verify API server**:
   ```bash
   kubectl get nodes --request-timeout=10s
   ```

### Short-term (This Week)

1. **Add kine optimization to test suite pre-flight**:
   - Modify `run-all-test-suites.sh` to optionally optimize kine
   - Add `OPTIMIZE_KINE=1` environment variable support

2. **Automate resource cleanup**:
   - Ensure `trim-completed-pods.sh` runs before test suites
   - Add to pre-flight checks

3. **Monitor kine performance**:
   - Add monitoring for "Slow SQL" warnings in k3s logs
   - Alert when optimization is needed

### Long-term (This Month)

1. **Consider PostgreSQL backend**:
   - Evaluate if SQLite is sufficient for workload
   - If not, migrate to PostgreSQL backend
   - Optimize PostgreSQL for kine workload

2. **Increase Colima resources**:
   - Allocate more CPU/memory if needed
   - Monitor resource usage during test runs

3. **Automated maintenance**:
   - Weekly kine optimization (cron job)
   - Daily resource cleanup
   - Proactive monitoring

## Monitoring

### Check kine Performance

```bash
# Monitor k3s logs for slow queries
colima ssh -- journalctl -u k3s -f | grep -i "slow sql"

# Check database size
colima ssh -- du -sh /var/lib/rancher/k3s/server/db/state.db

# Monitor API server response time
time kubectl get nodes
```

### Alert Thresholds

- **API server response time > 5 seconds**: Optimize kine
- **"Slow SQL" warnings in logs**: Optimize kine
- **Database size > 100MB**: Consider optimization
- **kubectl commands timing out**: Immediate optimization needed

## Database Tuning (Separate Issue)

**Note**: The 8 PostgreSQL databases (ports 5433-5440) are externalized and already tuned. They follow the pattern from port 5433's configuration:

- **Tuning files**: `infra/db/44-optimize-planner.sql`, `infra/db/optimize-listings-db.sql`
- **pgbench scripts**: `scripts/run_pgbench_sweep.sh` and service-specific variants
- **Target**: 1k-5.1k TPS peaks per database
- **Each DB tuned differently** based on workload (search, analytics, social, etc.)

**This is NOT the bottleneck** - kine is the bottleneck.

## Summary

**Root Cause**: kine (k3s database backend) performance degradation, not PostgreSQL connection pools.

**Fixes**:
1. ✅ Proactive kine optimization (VACUUM/ANALYZE/REINDEX)
2. ✅ Resource cleanup before tests
3. ⚠️ Consider PostgreSQL backend for heavy load
4. ⚠️ Increase Colima resources if needed
5. ✅ Regular k3s restarts

**Next Steps**:
1. Run kine optimization before next test run
2. Add automation to test suite pre-flight
3. Monitor kine performance
4. Consider PostgreSQL backend if SQLite continues to be a bottleneck

---

**Related Documents**:
- `K3S_KINE_OPTIMIZATION_GUIDE.md` - Detailed kine optimization guide
- `API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md` - API server timeout workarounds
- `scripts/optimize-k3s-kine-database.sh` - Automated kine optimization
- `scripts/trim-completed-pods.sh` - Resource cleanup script
