# Final Execution Plan - Fixes & Testing

## Status Summary

### ✅ Fixed
1. **Enhanced Test Packet Capture**: Updated to use pod-level capture (Caddy/Envoy pods) instead of Docker network interface
2. **Rotation Suite Limits**: Increased starting rates (H2=130, H3=65), larger increments (H2=+15, H3=+8), higher max iterations (30), more aggressive limits (1.5% drops allowed)
3. **HTTP/2 Protocol Verification**: Fixed curl output parsing order
4. **Proto Path Resolution**: Multiple fallback locations
5. **Kind Node Detection**: Docker container fallback

### 🔍 In Progress
1. **Database Foreign Key**: Verifying user creation in both databases (5433 and 5437)
2. **Records Service Foreign Key Constraint**: Testing if users are created in records DB (port 5433)

### ⏳ Next Steps
1. Verify user creation works in records DB (port 5433)
2. Test Records Create after database verification
3. Run full smoke test suite with fixed packet capture
4. Push rotation suite to absolute limits
5. Run k6 limit tests (max VUs, persistence, absolute max)

## Architecture Confirmed

**External Docker Databases** (used by all services):
- Port 5433: records DB (main) - has auth.users table ✅
- Port 5437: auth DB - has auth.users table ✅
- Both databases have auth.users (needed for foreign keys)

**Services**:
- auth-service → port 5437 (auth DB) ✅
- records-service → port 5433 (records DB) ✅
- Foreign key: records.records.user_id → auth.users.id (within same DB ✅)

## Test Suite Plan

### Phase 1: Database Verification
- ✅ Check auth.users exists in both databases
- ⏳ Verify user creation populates both databases (or just records DB)
- ⏳ Test Records Create with newly registered users

### Phase 2: Smoke Tests
- ⏳ Run baseline smoke test (`test-microservices-http2-http3.sh`)
- ⏳ Run enhanced wire-level test (`test-microservices-http2-http3-enhanced.sh`) - with fixed packet capture
- ⏳ Verify packet capture works on Caddy/Envoy pods
- ⏳ Verify protocol detection (HTTP/2, HTTP/3, gRPC)

### Phase 3: Rotation Suite - Push Limits
- ⏳ Start from last successful rate (H2=130, H3=65)
- ⏳ Use larger increments (H2=+15, H3=+8 per iteration)
- ⏳ Allow up to 1.5% drops to find absolute capacity
- ⏳ Continue until errors appear (not just drops)
- ⏳ Target: Find absolute max before errors

### Phase 4: k6 Limit Tests
- ⏳ Find max VUs (starting from rotation suite limit)
- ⏳ Persistence/soak test (long duration, stable rate)
- ⏳ Absolute max test (p90-p100 percentiles, Little's Law)

## Success Criteria

- ✅ Records Create works for newly registered users
- ✅ Packet capture works on pods (Caddy/Envoy)
- ✅ Protocol verification passes (HTTP/2, HTTP/3 detected)
- ✅ Rotation suite finds absolute limit (before errors)
- ✅ k6 limit tests complete with full metrics

## Commands to Run

```bash
# 1. Verify database state
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c "SELECT COUNT(*) FROM auth.users;"

# 2. Run baseline smoke test
bash scripts/test-microservices-http2-http3.sh

# 3. Run enhanced wire-level test
bash scripts/test-microservices-http2-http3-enhanced.sh

# 4. Run rotation suite (pushing limits)
bash scripts/rotation-suite.sh

# 5. Run k6 limit tests
bash scripts/load/k6-limit-test-comprehensive.js
```
