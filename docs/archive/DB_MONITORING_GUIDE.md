# Database Monitoring and Prevention Guide

## Overview
This guide provides monitoring strategies and prevention measures to avoid database connection pool exhaustion and performance issues. Use this guide to proactively monitor database health and prevent issues before they impact users.

## Quick Health Check

### Check Active Connections
```bash
# Check all databases
docker exec -it record-platform-postgres-1 psql -U postgres -c "
SELECT 
  datname,
  count(*) as active_connections,
  max_conn as max_connections,
  round(100.0 * count(*) / max_conn, 2) as usage_pct
FROM pg_stat_activity
JOIN pg_database ON pg_stat_activity.datid = pg_database.oid
WHERE datname IS NOT NULL
GROUP BY datname, max_conn
ORDER BY usage_pct DESC;
"
```

### Check Connection Pool Usage by Service
```bash
# Check which services are using connections
docker exec -it record-platform-postgres-1 psql -U postgres -c "
SELECT 
  application_name,
  count(*) as connections,
  state,
  datname
FROM pg_stat_activity
WHERE application_name IS NOT NULL
GROUP BY application_name, state, datname
ORDER BY connections DESC;
"
```

### Check for Long-Running Queries
```bash
# Find queries running longer than 30 seconds
docker exec -it record-platform-postgres-1 psql -U postgres -c "
SELECT 
  pid,
  application_name,
  datname,
  state,
  query_start,
  now() - query_start as duration,
  left(query, 100) as query_preview
FROM pg_stat_activity
WHERE state != 'idle'
  AND now() - query_start > interval '30 seconds'
ORDER BY duration DESC;
"
```

## Monitoring Scripts

### Daily Health Check Script
Create `scripts/monitor-db-health.sh`:

```bash
#!/usr/bin/env bash
# Daily database health check

set -euo pipefail

DB_CONTAINERS=(
  "record-platform-postgres-1"
  "record-platform-postgres-social-1"
  "record-platform-postgres-listings-1"
  "record-platform-postgres-shopping-1"
  "record-platform-postgres-auth-1"
  "record-platform-postgres-auction-monitor-1"
  "record-platform-postgres-analytics-1"
  "record-platform-postgres-python-ai-1"
)

echo "=== Database Health Check $(date) ==="
echo ""

for container in "${DB_CONTAINERS[@]}"; do
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "📊 ${container}:"
    docker exec "$container" psql -U postgres -c "
      SELECT 
        datname,
        count(*) as connections,
        max_conn as max_allowed,
        round(100.0 * count(*) / max_conn, 2) as usage_pct,
        CASE 
          WHEN 100.0 * count(*) / max_conn > 90 THEN '🔴 CRITICAL'
          WHEN 100.0 * count(*) / max_conn > 80 THEN '🟡 WARNING'
          ELSE '🟢 OK'
        END as status
      FROM pg_stat_activity
      JOIN pg_database ON pg_stat_activity.datid = pg_database.oid
      WHERE datname IS NOT NULL
      GROUP BY datname, max_conn;
    " 2>/dev/null || echo "  ⚠️  Container not running or database not accessible"
    echo ""
  else
    echo "⚠️  ${container}: Not running"
    echo ""
  fi
done
```

### Connection Pool Exhaustion Alert
Create `scripts/check-db-connections.sh`:

```bash
#!/usr/bin/env bash
# Check for connection pool exhaustion

set -euo pipefail

THRESHOLD=80  # Alert if usage > 80%

check_db() {
  local container=$1
  local db_name=$2
  
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    return 1
  fi
  
  local usage=$(docker exec "$container" psql -U postgres -t -c "
    SELECT round(100.0 * count(*) / max_conn, 2)
    FROM pg_stat_activity
    JOIN pg_database ON pg_stat_activity.datid = pg_database.oid
    WHERE datname = '$db_name'
    GROUP BY max_conn;
  " 2>/dev/null | tr -d ' ')
  
  if [[ -n "$usage" ]] && (( $(echo "$usage > $THRESHOLD" | bc -l) )); then
    echo "🔴 ALERT: ${container} (${db_name}) connection usage: ${usage}%"
    return 1
  fi
  
  return 0
}

# Check all databases
check_db "record-platform-postgres-1" "records" || exit 1
check_db "record-platform-postgres-social-1" "records" || exit 1
check_db "record-platform-postgres-listings-1" "records" || exit 1
check_db "record-platform-postgres-shopping-1" "records" || exit 1
check_db "record-platform-postgres-auth-1" "records" || exit 1
check_db "record-platform-postgres-auction-monitor-1" "auction_monitor" || exit 1
check_db "record-platform-postgres-analytics-1" "analytics" || exit 1
check_db "record-platform-postgres-python-ai-1" "python_ai" || exit 1

echo "✅ All databases within safe connection limits"
```

## Prometheus Metrics

### Key Metrics to Monitor

1. **Active Connections**
   - Metric: `pg_stat_database_numbackends`
   - Alert: `> max_connections * 0.9`

2. **Connection Wait Time**
   - Metric: `pg_stat_database_blks`
   - Alert: High wait time indicates pool exhaustion

3. **Query Duration**
   - Metric: `pg_stat_statements_mean_exec_time`
   - Alert: `> 5 seconds` (indicates slow queries)

4. **Connection Errors**
   - Metric: Service-level connection error rate
   - Alert: `> 5%` of total queries

### Prometheus Queries

```promql
# Active connections per database
pg_stat_database_numbackends{datname!~"template.*"}

# Connection usage percentage
(pg_stat_database_numbackends{datname!~"template.*"} / pg_settings_max_connections) * 100

# Long-running queries
pg_stat_activity_state{state="active"} and pg_stat_activity_query_duration > 30
```

## Grafana Dashboard

### Recommended Dashboard Panels

1. **Connection Pool Usage**
   - Graph: Active connections over time
   - Gauge: Current usage percentage
   - Alert: Red when > 90%

2. **Connection Errors**
   - Graph: Connection error rate
   - Alert: Red when > 5%

3. **Query Performance**
   - Graph: Average query duration
   - Table: Top 10 slowest queries

4. **Service Connection Distribution**
   - Pie chart: Connections by application_name
   - Table: Connections per service

## Prevention Checklist

### Before Scaling Services
- [ ] Calculate new total pool size: `max_pool_size × replicas`
- [ ] Verify: `total_pool_size < max_connections × 0.8`
- [ ] Check current connection usage
- [ ] Monitor after scaling for 15 minutes

### Before Deploying New Features
- [ ] Review database queries for N+1 problems
- [ ] Check for connection leaks (connections not released)
- [ ] Verify retry logic is in place
- [ ] Test under load (k6 tests)

### Weekly Maintenance
- [ ] Run health check script
- [ ] Review slow query log
- [ ] Check for connection pool exhaustion
- [ ] Review error logs for connection issues
- [ ] Verify all services follow DB_CONFIGURATION_STANDARD.md

### Monthly Review
- [ ] Analyze connection pool usage trends
- [ ] Review and optimize slow queries
- [ ] Check database growth and plan capacity
- [ ] Review and update pool sizes if needed
- [ ] Update monitoring alerts based on trends

## Troubleshooting

### Connection Pool Exhaustion

**Symptoms:**
- "Sorry, too many clients already" errors
- High connection wait times
- Service timeouts

**Immediate Actions:**
1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Identify service with most connections
3. Check for connection leaks (long-running idle connections)
4. Temporarily increase pool size or database max_connections
5. Restart affected service to clear stuck connections

**Long-term Fix:**
1. Review service pool configuration
2. Fix connection leaks in code
3. Optimize slow queries
4. Consider connection pooling middleware (PgBouncer)

### High Connection Error Rate

**Symptoms:**
- Frequent "connection refused" errors
- Connection timeouts
- Service health check failures

**Immediate Actions:**
1. Check database container health: `docker ps`
2. Check database logs: `docker logs record-platform-postgres-1`
3. Verify network connectivity
4. Check for database restarts

**Long-term Fix:**
1. Increase connection timeout
2. Add retry logic with exponential backoff
3. Implement circuit breaker pattern
4. Monitor database resource usage (CPU, memory)

### Slow Queries

**Symptoms:**
- High query duration
- Timeout errors
- Database CPU usage spikes

**Immediate Actions:**
1. Find slow queries: `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;`
2. Check for table locks: `SELECT * FROM pg_locks WHERE NOT granted;`
3. Analyze query plans: `EXPLAIN ANALYZE <query>;`

**Long-term Fix:**
1. Add missing indexes
2. Optimize query structure
3. Consider query caching
4. Partition large tables if needed

## Automated Monitoring

### Cron Job Setup

Add to crontab for daily health checks:

```bash
# Daily database health check at 9 AM
0 9 * * * /path/to/scripts/monitor-db-health.sh >> /var/log/db-health.log 2>&1

# Hourly connection check
0 * * * * /path/to/scripts/check-db-connections.sh >> /var/log/db-connections.log 2>&1
```

### CI/CD Integration

Add database health checks to CI/CD pipeline:

```yaml
# .github/workflows/db-health-check.yml
name: Database Health Check
on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check database connections
        run: ./scripts/check-db-connections.sh
```

## Best Practices Summary

1. **Monitor Proactively**: Don't wait for issues to occur
2. **Set Alerts Early**: Alert at 80% usage, not 100%
3. **Review Regularly**: Weekly health checks, monthly deep dives
4. **Document Changes**: Update DB_CONFIGURATION_STANDARD.md when changing pool sizes
5. **Test Under Load**: Always test pool configuration changes with k6
6. **Follow Standards**: All services must follow DB_CONFIGURATION_STANDARD.md
7. **Automate Monitoring**: Use scripts and cron jobs for regular checks

## Emergency Contacts

If database issues occur:
1. Check this guide first
2. Review DB_CONFIGURATION_STANDARD.md
3. Check service logs: `kubectl logs -n record-platform -l app=<service-name>`
4. Check database logs: `docker logs <container-name>`
5. Escalate if issue persists after following troubleshooting steps
