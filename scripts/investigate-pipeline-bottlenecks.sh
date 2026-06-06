#!/usr/bin/env bash
set -euo pipefail

# Script to investigate timeout and connection errors in Analytics → Python AI pipeline
# Checks: database connections, HTTP client config, network protocols, query performance

NS="${NS:-record-platform}"
ANALYTICS_POD=$(kubectl -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
PYTHON_AI_POD=$(kubectl -n "$NS" get pods -l app=python-ai-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

echo "🔍 Investigating Analytics → Python AI Pipeline Bottlenecks"
echo "============================================================"
echo ""

# 1. Check HTTP client configuration
echo "📡 1. HTTP Client Configuration"
echo "-------------------------------"
echo "Python AI Service uses httpx.AsyncClient (HTTP/1.1 by default)"
echo "  - No HTTP/2 or HTTP/3 support"
echo "  - No connection multiplexing (one request per connection)"
echo "  - Connection pool: max_connections=100, max_keepalive=20"
echo "  - Timeout: 5s with 3 retries (exponential backoff)"
echo ""

# 2. Check database connection pools
echo "🗄️  2. Database Connection Pools"
echo "---------------------------------"
if [ -n "$ANALYTICS_POD" ]; then
  echo "Analytics Service:"
  kubectl -n "$NS" exec "$ANALYTICS_POD" -- sh -c "
    node -e \"
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL_ANALYTICS });
    pool.query('SELECT count(*) as active, setting as max_conn FROM pg_stat_activity, pg_settings WHERE name = \\'max_connections\\' GROUP BY setting LIMIT 1')
      .then(r => console.log('  Active connections:', r.rows[0]?.active || 'N/A', '| Max:', r.rows[0]?.max_conn || 'N/A'))
      .catch(e => console.log('  Error:', e.message));
    pool.end();
    \"
  " 2>/dev/null || echo "  Could not check (pod not ready)"
else
  echo "  Analytics pod not found"
fi

if [ -n "$PYTHON_AI_POD" ]; then
  echo "Python AI Service:"
  kubectl -n "$NS" exec "$PYTHON_AI_POD" -- python3 -c "
import asyncio
import asyncpg
import os
async def check():
    try:
        pool = await asyncpg.create_pool(os.getenv('POSTGRES_URL_PYTHON_AI', ''), min_size=1, max_size=1)
        async with pool.acquire() as conn:
            result = await conn.fetchval('SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()')
            max_conn = await conn.fetchval('SELECT setting FROM pg_settings WHERE name = \\'max_connections\\'')
            print(f'  Active connections: {result} | Max: {max_conn}')
        await pool.close()
    except Exception as e:
        print(f'  Error: {e}')
asyncio.run(check())
  " 2>/dev/null || echo "  Could not check (pod not ready)"
else
  echo "  Python AI pod not found"
fi
echo ""

# 3. Check slow queries
echo "🐌 3. Slow Queries Analysis"
echo "---------------------------"
if [ -n "$ANALYTICS_POD" ]; then
  echo "Analytics Service (top 5 slowest queries):"
  kubectl -n "$NS" exec "$ANALYTICS_POD" -- psql "$POSTGRES_URL_ANALYTICS" -c "
    SELECT 
      query,
      calls,
      mean_exec_time::numeric(10,2) as avg_ms,
      max_exec_time::numeric(10,2) as max_ms,
      total_exec_time::numeric(10,2) as total_s
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
    ORDER BY mean_exec_time DESC
    LIMIT 5;
  " 2>/dev/null || echo "  pg_stat_statements not enabled or pod not ready"
else
  echo "  Analytics pod not found"
fi
echo ""

# 4. Check network connectivity
echo "🌐 4. Network Connectivity"
echo "--------------------------"
if [ -n "$PYTHON_AI_POD" ] && [ -n "$ANALYTICS_POD" ]; then
  echo "Testing Python AI → Analytics connectivity:"
  kubectl -n "$NS" exec "$PYTHON_AI_POD" -- sh -c "
    timeout 5 curl -s -o /dev/null -w '  HTTP Status: %{http_code} | Time: %{time_total}s\n' \
      http://analytics-service.record-platform.svc.cluster.local:4004/healthz || echo '  Connection failed or timeout'
  " 2>/dev/null || echo "  Could not test connectivity"
else
  echo "  Pods not found"
fi
echo ""

# 5. Check connection errors in logs
echo "📋 5. Recent Connection Errors"
echo "------------------------------"
if [ -n "$PYTHON_AI_POD" ]; then
  echo "Python AI Service (last 10 connection/timeout errors):"
  kubectl -n "$NS" logs "$PYTHON_AI_POD" --tail=100 2>&1 | \
    grep -iE "(connection|timeout|refused|reset|EOF)" | tail -10 || echo "  No recent errors found"
fi
echo ""

# 6. Recommendations
echo "💡 6. Recommendations"
echo "---------------------"
echo "1. HTTP/2 Support:"
echo "   - Analytics service uses Express (HTTP/1.1 only)"
echo "   - Consider upgrading to HTTP/2 or gRPC for better multiplexing"
echo "   - httpx supports HTTP/2 but requires server support"
echo ""
echo "2. Connection Pooling:"
echo "   - Analytics: max=30 connections (may be exhausted under load)"
echo "   - Python AI: max=50 connections (adequate)"
echo "   - Consider increasing analytics pool or using PgBouncer"
echo ""
echo "3. Timeout Optimization:"
echo "   - Current: 5s timeout with 3 retries (total ~15s max)"
echo "   - Analytics predict-price uses worker threads (may be slow)"
echo "   - Consider async processing or caching"
echo ""
echo "4. Database Query Optimization:"
echo "   - Check pg_stat_statements for slow queries"
echo "   - Add indexes on frequently queried columns"
echo "   - Consider query result caching"
echo ""

