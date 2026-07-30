# Database and Cache Verification

## Overview

All test suites now include comprehensive database and cache verification after each test to prove:
- **Database operations** are persisted correctly
- **Redis cache** is working (hit/miss rates)
- **Lua singleflight scripts** are loaded and functioning
- **Shopping cart operations** are verified (including checkout removal)
- **messaging-plane operations** are verified (posts, messages)

## Scripts

### 1. `verify-db-cache-quick.sh`
Quick verification called after each test suite:
- Database connectivity check (all ports)
- Redis cache hit/miss verification
- Lua script verification (proves singleflight working)
- Shopping cart verification
- messaging-plane verification

### 2. `verify-db-and-cache-comprehensive.sh`
Comprehensive verification with detailed analysis:
- Full database connectivity matrix
- Detailed cache statistics
- HTTP/3 packet capture verification
- messaging-plane health checks
- Complete shopping cart analysis

### 3. `run-preflight-and-test-suite.sh`
Main wrapper script that:
- Runs preflight
- Runs test suite
- **Timestamps all output** (handles terminal wraparound)
- Pipes all results to timestamped log files

## Usage

### Run Preflight + Test Suite with Timestamps

```bash
./scripts/run-preflight-and-test-suite.sh
```

This will:
1. Run preflight (`run-preflight-scale-and-all-suites.sh`)
2. Run all test suites (`run-all-test-suites.sh`)
3. **Automatically run DB & cache verification after EACH test suite**
4. Timestamp all output to handle terminal wraparound
5. Save all results to `test-results/<timestamp>-preflight-and-tests/`

### Run Test Suites Only

```bash
./scripts/run-all-test-suites.sh
```

This will:
- Run all test suites (baseline, enhanced, adversarial, rotation, standalone, tls-mtls)
- **Run DB & cache verification after EACH suite**
- Save results to `/tmp/suite-logs-<timestamp>/`

### Run Final Test Suite

```bash
./scripts/run-final-test-suite.sh
```

This will:
- Run smoke test
- Run HTTP/2 limit test
- Run HTTP/3 limit test
- **Run DB & cache verification after EACH test**
- Save results to `test-results/<timestamp>-final-test-suite/`

## Verification Details

### After Each Test Suite

The verification checks:

1. **Database Connectivity** (ports 5437, 5433, 5434, 5435, 5436)
   - Auth DB (5437)
   - Records DB (5433)
   - Social DB (5434)
   - Listings DB (5435)
   - Shopping DB (5436)

2. **Cache Verification**
   - Redis connectivity
   - Cache hit/miss rates (proves Redis working)
   - Lua script verification (proves singleflight Lua working)

3. **Shopping Cart Verification**
   - Cart items count
   - Orders count (items removed during checkout)
   - Purchase history

4. **Messaging Service Verification**
   - Forum posts count
   - Messages count
   - Service health

## Output Files

### Timestamped Logs

All output is timestamped to handle terminal wraparound:
```
[2026-01-22 12:34:56] ✅ Test passed
[2026-01-22 12:34:57] ⚠️  Warning message
```

### Log Locations

- **Preflight + Test Suite**: `test-results/<timestamp>-preflight-and-tests/`
  - `main.log` - All output
  - `preflight.log` - Preflight output
  - `test-suite.log` - Test suite output
  - `SUMMARY.md` - Summary report

- **Test Suites Only**: `/tmp/suite-logs-<timestamp>/`
  - `<suite-name>.log` - Each suite output
  - `<suite-name>-verification.log` - DB & cache verification after each suite
  - `comprehensive-verification.log` - Final comprehensive verification

- **Final Test Suite**: `test-results/<timestamp>-final-test-suite/`
  - `01-smoke-test.log` - Smoke test
  - `01-verification-smoke.log` - Verification after smoke test
  - `02-verification-http2.log` - Verification after HTTP/2 test
  - `03-verification-http3.log` - Verification after HTTP/3 test

## Analyzing Results

### Quick Analysis

```bash
# View all results with timestamps
cat test-results/*/main.log | grep -E '(✅|❌|⚠️|FAILED|error|PASSED)'

# Analyze test results
./scripts/analyze-test-results.sh /tmp/suite-logs-<timestamp>
```

### Cache Hit Rate

Look for lines like:
```
✅ Cache hit rate: 75.50% (151 hits, 49 misses) - PROVES Redis working
✅ Lua scripts: Loaded (PROVES singleflight Lua working)
```

### Database Operations

Look for lines like:
```
✅ Shopping cart: Empty, 2 order(s) created (DB operation verified - items removed during checkout)
✅ Forum posts: 5 (DB operation verified)
✅ Messages: 10 (DB operation verified)
```

## Key Features

1. **Automatic Verification**: Runs after each test suite automatically
2. **Timestamped Output**: Handles terminal wraparound
3. **Proves Redis + Lua**: Verifies cache hit rates and Lua scripts
4. **Proves DB Operations**: Verifies all database operations persisted
5. **Comprehensive Logging**: All results saved to timestamped files

## Troubleshooting

### Redis Not Found

If Redis is externalized (not in cluster), you'll see:
```
ℹ️  Redis: Externalized (not in cluster) - cache verification skipped
```

This is expected if Redis is running outside Kubernetes.

### Missing User IDs

If `USER1_ID` is not set, verification will still check:
- Database connectivity
- Overall table health
- Cache connectivity (if Redis available)

### Messaging Service 502 Errors

Check verification logs for:
```
⚠️  messaging-plane health endpoint: 502 upstream error
```

This indicates messaging-service pod may be down or unreachable.
