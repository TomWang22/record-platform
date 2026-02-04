# k3s kine Database Optimization Guide

## Overview
k3s uses **kine** as its database backend, which can use SQLite (default), PostgreSQL, or MySQL. When kine performance degrades, the k3s API server becomes unresponsive.

## Problem: Slow SQL Queries
Symptoms:
- API server timeouts
- "Slow SQL" warnings in k3s logs
- kubectl commands timing out
- Cluster becomes unresponsive

## Solutions

### 1. SQLite Optimization (Default Backend)

#### Quick Fix: Restart k3s
```bash
colima kubernetes stop
sleep 5
colima kubernetes start
```

#### Deep Optimization: Vacuum and Reindex
**⚠️ Requires stopping k3s (brief downtime)**

```bash
# Stop k3s
colima kubernetes stop

# Optimize database
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

Or use the automated script:
```bash
bash scripts/optimize-k3s-kine-database.sh
```

### 2. PostgreSQL Backend (Better Performance)

For production or high-resource clusters, use PostgreSQL:

```bash
# Configure k3s to use PostgreSQL
colima ssh -- sh -c "
cat > /etc/systemd/system/k3s.service.env <<EOF
K3S_DATASTORE_ENDPOINT=postgres://user:password@localhost:5432/k3s
EOF
"

# Restart k3s
colima kubernetes stop
colima kubernetes start
```

PostgreSQL optimization:
```sql
-- Connect to k3s database
\c k3s

-- Vacuum and analyze
VACUUM ANALYZE;

-- Check slow queries
SELECT * FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

-- Add indexes if needed (check query patterns first)
CREATE INDEX IF NOT EXISTS idx_kine_name ON kine(name);
CREATE INDEX IF NOT EXISTS idx_kine_deleted ON kine(deleted);
```

### 3. MySQL Backend

```bash
# Configure k3s to use MySQL
colima ssh -- sh -c "
cat > /etc/systemd/system/k3s.service.env <<EOF
K3S_DATASTORE_ENDPOINT=mysql://user:password@tcp(localhost:3306)/k3s
EOF
"

# Restart k3s
colima kubernetes stop
colima kubernetes start
```

MySQL optimization:
```sql
-- Optimize tables
OPTIMIZE TABLE kine;

-- Check slow queries
SELECT * FROM mysql.slow_log 
ORDER BY start_time DESC 
LIMIT 10;
```

## Prevention Strategies

### 1. Regular Maintenance
- **Weekly k3s restarts** to prevent accumulation
- **Monthly database optimization** (vacuum/reindex)
- **Monitor for "Slow SQL" warnings**

### 2. Resource Cleanup
```bash
# Clean up completed jobs
kubectl delete jobs --field-selector status.successful=1 -A

# Remove old ReplicaSets
kubectl delete rs --field-selector status.replicas=0 -A

# Clean up old pods
kubectl delete pods --field-selector status.phase=Succeeded -A
```

### 3. Monitoring
```bash
# Monitor k3s logs for slow queries
colima ssh -- journalctl -u k3s -f | grep -i "slow sql"

# Check database size
colima ssh -- du -sh /var/lib/rancher/k3s/server/db/state.db

# Monitor API server response time
time kubectl get nodes
```

### 4. Configuration Tuning

#### SQLite Performance Settings
SQLite in k3s can be tuned via environment variables (requires k3s restart):

```bash
# Increase cache size (default: -2000 pages, ~2MB)
# Set to -64000 for ~64MB cache
colima ssh -- sh -c "
cat >> /etc/systemd/system/k3s.service.env <<EOF
K3S_DATASTORE_CAFILE=/path/to/ca.pem
EOF
"
```

Note: k3s doesn't expose all SQLite tuning options directly. For better performance, consider PostgreSQL.

## When to Switch to PostgreSQL

Consider PostgreSQL if:
- Cluster has 50+ pods
- Frequent "Slow SQL" warnings
- API server timeouts during normal operations
- Need production-grade reliability

## Automated Scripts

1. **`scripts/optimize-k3s-kine-database.sh`**
   - Detects database backend
   - Optimizes SQLite (vacuum, reindex)
   - Provides recommendations for PostgreSQL/MySQL

2. **`scripts/monitor-k3s-restart.sh`**
   - Monitors k3s restart progress
   - Verifies API server recovery
   - Checks cluster health

3. **`scripts/deep-cluster-health-check.sh`**
   - Comprehensive cluster health check
   - Detects zombie pods
   - Checks resource usage
   - Operational hygiene audit

## Troubleshooting

### API Server Still Not Accessible After Restart

1. **Check k3s status:**
   ```bash
   colima ssh -- systemctl status k3s
   ```

2. **Check k3s logs:**
   ```bash
   colima ssh -- journalctl -u k3s -n 100
   ```

3. **Full Colima restart:**
   ```bash
   colima stop
   colima start
   ```

4. **Check database file permissions:**
   ```bash
   colima ssh -- ls -la /var/lib/rancher/k3s/server/db/
   ```

### Database Locked Errors

If you see "database is locked" errors:
- Wait for k3s to fully stop (check process)
- Ensure no other processes are accessing the database
- Consider using PostgreSQL to avoid locking issues

## Performance Benchmarks

Expected performance:
- **SQLite**: < 10ms for simple queries, < 100ms for complex queries
- **PostgreSQL**: < 5ms for simple queries, < 50ms for complex queries

If queries exceed these times, optimization is needed.

## Related Documentation

- [k3s Datastore Configuration](https://docs.k3s.io/datastore)
- [kine GitHub Repository](https://github.com/k3s-io/kine)
- [SQLite Optimization](https://www.sqlite.org/optoverview.html)
