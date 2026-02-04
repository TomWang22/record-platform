# Test Failures Fix Plan - Restore Previous Working State

## Context
Tests used to pass in the past, but currently showing regressions. Need to systematically restore functionality.

## Current Status Analysis

### ✅ Working
- **Rotation Suite**: 195 req/s limit found (H2=130, H3=65) ✅
- **HTTP/2 REST API**: Most endpoints working ✅
- **gRPC HealthChecks**: All 8 services healthy ✅
- **Shopping, Social, Listings**: Full CRUD operations ✅

### ❌ Failing Issues (Need Fix)

#### 1. Records Service - Foreign Key Constraint ❌ **CRITICAL**
**Symptom**: `Foreign key constraint violated on the constraint: records_user_id_fkey`
**Root Cause**: Newly registered users don't appear in auth.users table in either database (5433 or 5437)
**Impact**: Cannot create records for newly registered users
**Previous State**: This worked before, so auth-service must have changed or database configuration changed

**Investigation Plan**:
1. Check auth-service logs during registration to see where users are created
2. Verify auth-service DATABASE_URL environment variable points to correct port
3. Check if there's a schema mismatch or transaction isolation issue
4. Verify if users are created in a different table/schema than expected
5. Check for async user creation patterns (JWT issued before DB commit)

**Fix Strategy**:
- Ensure auth-service creates users in port 5437 (auth DB) - auth.users table
- Verify records-service queries port 5437 for user validation
- Add retry logic or wait for user propagation if async

#### 2. HTTP/3 Connection Failures ❌ **HIGH PRIORITY**
**Symptom**: All HTTP/3 tests fail with "curl exit 1"
**Root Cause**: Kind cluster node not found for HTTP/3 Docker network namespace
**Impact**: Cannot test HTTP/3/QUIC functionality
**Previous State**: HTTP/3 worked before via Docker container network

**Investigation Plan**:
1. Check if Kind cluster is actually running (`kubectl get nodes`)
2. Verify Docker container names for Kind nodes
3. Test enhanced Kind node detection (already fixed in http3.sh)
4. Verify alpine/curl-http3 Docker image is available
5. Test HTTP/3 connection manually via Docker

**Fix Strategy**:
- Enhanced Kind node detection (✅ already applied)
- Test with corrected detection logic
- If still failing, use alternative HTTP/3 testing method (port-forward or k6)

#### 3. gRPC SearchRecords Empty Response ⚠️ **MEDIUM**
**Symptom**: gRPC SearchRecords returns `{}` (empty response)
**Root Cause**: Proto path resolution issue OR service actually returning empty results
**Impact**: Cannot test records search via gRPC
**Previous State**: gRPC SearchRecords worked before

**Investigation Plan**:
1. Test with fixed proto path (✅ already applied)
2. Check if user_id from JWT actually has records in database
3. Verify records-service SearchRecords implementation
4. Test with existing users that have records

**Fix Strategy**:
- Use fixed proto path resolution (✅ already applied)
- Test with valid user_id that has existing records
- Add better error handling/logging in test script

#### 4. HTTP/2 Protocol Verification Parsing ⚠️ **LOW**
**Symptom**: Shows "HTTP Version: 201" instead of "HTTP Version: 2"
**Root Cause**: curl output parsing order incorrect
**Impact**: Protocol verification false negatives in enhanced test
**Previous State**: Parsing was correct before

**Fix Strategy**:
- ✅ Already fixed - corrected curl output parsing order

## Execution Plan

### Phase 1: Critical Fixes (Records Service)
1. **Investigate auth-service user creation**
   - Check auth-service deployment config (DATABASE_URL)
   - Review auth-service registration code/logs
   - Verify database connection pooling/transaction behavior
   - Test registration with logging enabled

2. **Verify database schema alignment**
   - Ensure auth.users table exists in both databases if needed
   - Check foreign key constraints in records.records table
   - Verify records-service queries correct database port

3. **Fix user creation flow**
   - Ensure users created in port 5437 (auth DB)
   - Add validation that user exists before JWT issuance
   - Add retry/wait logic in records-service if needed

### Phase 2: HTTP/3 Restoration
1. **Test enhanced Kind node detection**
   - Run HTTP/3 test with fixed http3.sh
   - Verify Docker container network access
   - Test HTTP/3 connection manually

2. **Alternative HTTP/3 testing if needed**
   - Use k6 HTTP/3 tests (inside cluster)
   - Use port-forward method for HTTP/3
   - Verify Caddy QUIC configuration

### Phase 3: gRPC SearchRecords
1. **Test with fixed proto path**
   - Re-run gRPC SearchRecords test
   - Use existing user with records
   - Verify service actually returns data

### Phase 4: Validation & k6 Limit Tests
1. **Re-run full smoke test suite**
   - Baseline smoke test
   - Enhanced wire-level test
   - Rotation suite

2. **k6 Load & Limit Tests**
   - Find max VUs for current setup
   - Test persistence (soak test)
   - Test absolute max (p90-p100 with Little's Law)

## Testing Strategy

### Immediate Next Steps
1. **Check auth-service database config and logs**
2. **Verify user creation actually happens** (add logging)
3. **Test HTTP/3 with enhanced detection**
4. **Re-run smoke tests after fixes**

### Validation Criteria
- ✅ Records Service: Can create records for newly registered users
- ✅ HTTP/3: At least health check works via HTTP/3
- ✅ gRPC: SearchRecords returns valid results (even if empty array)
- ✅ All previous working functionality still works

## Architecture Notes

**Envoy**: Handles HTTP/2 and gRPC (port 10000, NodePort 30000/30001)
**Caddy**: Handles HTTP/3/QUIC and REST API (port 443, NodePort 30443)

**Database Layout**:
- Port 5433: records DB (main) - has auth.users (50,360 users)
- Port 5437: auth DB - has auth.users (158,289 users)
- **Issue**: New registrations don't appear in either immediately

## Priority Order
1. **P0**: Records Service foreign key (blocks core functionality)
2. **P1**: HTTP/3 connection (needed for protocol verification)
3. **P2**: gRPC SearchRecords (nice to have, not blocking)
4. **P3**: Protocol verification parsing (already fixed)
