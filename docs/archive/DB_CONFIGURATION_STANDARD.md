# Database Configuration Standard

## Overview
This document defines the standard database connection pool configuration for all services in the record-platform. Following this standard prevents connection pool exhaustion, ensures optimal performance, and maintains consistency across services.

## Database Infrastructure

### PostgreSQL Databases (8 total)
All databases run in Docker Compose with the following configuration:
- **max_connections**: 500 (configured in docker-compose.yml)
- **shared_buffers**: 1GB
- **effective_cache_size**: 4GB
- **shm_size**: 1GB (for high-concurrency databases)

| Database | Port | Service | Purpose |
|----------|------|---------|---------|
| postgres | 5433 | Default | General records |
| postgres-social | 5434 | social-service | Social features (messages, forums) |
| postgres-listings | 5435 | listings-service | Listings and search |
| postgres-shopping | 5436 | shopping-service | Shopping cart and orders |
| postgres-auth | 5437 | auth-service | Authentication and users |
| postgres-auction-monitor | 5438 | auction-monitor | Auction monitoring |
| postgres-analytics | 5439 | analytics-service | Analytics and price snapshots |
| postgres-python-ai | 5440 | python-ai-service | AI predictions and cache |

## Connection Pool Sizing Formula

### Standard Formula
```
max_pool_size = (VUs × avg_concurrent_per_vu × replicas) + headroom
```

Where:
- **VUs** (Virtual Users): Expected concurrent users (default: 50 for k6 tests)
- **avg_concurrent_per_vu**: Average concurrent requests per user (default: 2)
- **replicas**: Number of service replicas (default: 1, can scale to 2-3)
- **headroom**: Buffer for burst traffic (default: 50 connections)

### Standard Pool Configuration

For services with **1 replica** and **50 VUs**:
- **max**: 100-150 connections (balanced for baseline)
- **min**: 10 connections (keep warm)
- **idleTimeoutMillis**: 60000 (1 minute)
- **connectionTimeoutMillis**: 10000-15000 (10-15 seconds)
- **statement_timeout**: 30000 (30 seconds)
- **query_timeout**: 30000 (30 seconds)

For services with **high concurrency** (shopping, social):
- **max**: 100-150 connections
- **min**: 10-15 connections

For services with **moderate concurrency** (listings, analytics):
- **max**: 75-100 connections
- **min**: 10 connections

For services with **low concurrency** (auth, auction-monitor):
- **max**: 50-75 connections
- **min**: 5-10 connections

## Service-Specific Configurations

### auth-service (Prisma)
- **connection_limit**: 100 (Prisma parameter)
- **pool_timeout**: 30 seconds
- **Note**: Uses single shared PrismaClient instance to avoid pool exhaustion

### social-service
- **max**: 50 (configurable via DB_POOL_MAX, default 50)
- **min**: 5 (configurable via DB_POOL_MIN, default 5)
- **High concurrency**: Messages, forums, real-time features

### listings-service
- **max**: 75 (configurable via DB_POOL_MAX, default 75)
- **min**: 10 (configurable via DB_POOL_MIN, default 10)
- **Moderate concurrency**: Search, listings, watchlist

### shopping-service
- **max**: 100 (configurable via DB_POOL_MAX, default 100)
- **min**: 10 (configurable via DB_POOL_MIN, default 10)
- **High concurrency**: Cart, checkout, orders

### analytics-service
- **listingsPool max**: 100
- **analyticsPool max**: 100
- **Dual-DB**: Uses two pools for cross-database queries

### python-ai-service (asyncpg)
- **max_size**: 75
- **min_size**: 10
- **command_timeout**: 60 seconds
- **timeout**: 10 seconds (connection timeout)

### auction-monitor
- **listingsPool max**: 50 (reading watchlist)
- **auctionPool max**: 50 (writing results)
- **Low concurrency**: Background worker service

## Environment Variables

### Standard Variables
```bash
# Service-specific database URLs
POSTGRES_URL_AUTH=postgresql://postgres:postgres@host.docker.internal:5437/records
POSTGRES_URL_SOCIAL=postgresql://postgres:postgres@host.docker.internal:5434/records
POSTGRES_URL_LISTINGS=postgresql://postgres:postgres@host.docker.internal:5435/records
POSTGRES_URL_SHOPPING=postgresql://postgres:postgres@host.docker.internal:5436/records
POSTGRES_URL_ANALYTICS=postgresql://postgres:postgres@host.docker.internal:5439/analytics
POSTGRES_URL_AUCTION_MONITOR=postgresql://postgres:postgres@host.docker.internal:5438/auction_monitor
POSTGRES_URL_PYTHON_AI=postgresql://postgres:postgres@host.docker.internal:5440/python_ai

# Optional pool configuration (overrides defaults)
DB_POOL_MAX=100  # Maximum connections in pool
DB_POOL_MIN=10   # Minimum connections in pool
```

## Error Handling Standards

### Required Error Handling
All services MUST implement:

1. **Connection Error Detection**
   - Detect connection termination, timeouts, ECONNREFUSED
   - Log errors with service name prefix

2. **Retry Logic**
   - Exponential backoff: 1s, 2s, 4s (max 5s)
   - Max 3 retries for connection errors
   - No retries for query errors (syntax, constraint violations)

3. **Pool Error Handlers**
   ```typescript
   pool.on('error', (err) => {
     console.error('[service-name] Unexpected DB pool error:', err)
     // Pool will automatically retry on next query
   })
   ```

4. **Keep-Alive Settings**
   - Enable keepAlive for connection reuse
   - keepAliveInitialDelayMillis: 10000 (10 seconds)

## Monitoring and Alerting

### Key Metrics to Monitor
1. **Active Connections**: Should stay below 80% of max_connections
2. **Pool Wait Time**: Time waiting for available connection
3. **Connection Errors**: Rate of connection failures
4. **Query Timeout Rate**: Percentage of queries timing out

### Alert Thresholds
- **Connection Pool Exhaustion**: Active connections > 90% of max
- **High Error Rate**: Connection errors > 5% of total queries
- **Query Timeouts**: Timeout rate > 1% of queries

### Monitoring Queries
```sql
-- Check active connections per database
SELECT datname, count(*) as connections
FROM pg_stat_activity
WHERE datname IS NOT NULL
GROUP BY datname;

-- Check connection pool usage
SELECT 
  application_name,
  count(*) as active_connections,
  max_connections as max_allowed
FROM pg_stat_activity
JOIN pg_database ON pg_stat_activity.datid = pg_database.oid
GROUP BY application_name, max_connections;
```

## Best Practices

### DO
✅ Use connection pooling (never create connections per request)
✅ Configure appropriate pool sizes based on expected load
✅ Implement retry logic for connection errors
✅ Monitor connection pool usage
✅ Use environment variables for pool configuration
✅ Enable keep-alive for connection reuse
✅ Set appropriate timeouts (connection, query, statement)

### DON'T
❌ Create multiple pool instances (use singleton pattern)
❌ Set pool size higher than database max_connections
❌ Ignore connection errors
❌ Use default pool sizes without consideration
❌ Create connections without pooling
❌ Set timeouts too high (prevents detection of issues)

## Scaling Considerations

### When Scaling Services
1. **Calculate new pool size**: `max_pool_size × replicas`
2. **Check database capacity**: Ensure `total_pool_size < max_connections × 0.8`
3. **Monitor after scaling**: Watch for connection exhaustion
4. **Adjust if needed**: Reduce pool size per replica if hitting limits

### Example: Scaling listings-service to 3 replicas
- Current: 1 replica × 75 connections = 75 total
- Scaled: 3 replicas × 75 connections = 225 total
- Database capacity: 500 max_connections × 0.8 = 400 available
- ✅ Safe: 225 < 400

## Troubleshooting

### Connection Pool Exhaustion
**Symptoms**: "Sorry, too many clients already" errors

**Solutions**:
1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Identify service with most connections
3. Reduce pool size or increase database max_connections
4. Check for connection leaks (connections not being released)

### High Connection Error Rate
**Symptoms**: Frequent connection timeouts or ECONNREFUSED

**Solutions**:
1. Check database health: `docker ps` and logs
2. Verify network connectivity
3. Increase connection timeout
4. Check for network issues between services and databases

### Query Timeouts
**Symptoms**: Queries timing out frequently

**Solutions**:
1. Optimize slow queries (add indexes, rewrite queries)
2. Increase statement_timeout if queries are legitimately slow
3. Check for database locks or contention
4. Review query execution plans

## Change Log
- **2026-01-22**: Initial standard created after database configuration cleanup
- Standardized all service pool configurations
- Fixed auction-monitor missing pool configuration
- Optimized database settings in docker-compose.yml
