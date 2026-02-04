# Next Steps After Enhanced Test Completes

## Current Status

### ✅ Completed
1. **Baseline Smoke Test** - Database verification added
2. **Enhanced Test Script** - All adversarial tests + database verification added
3. **Rotation Suite** - Limits increased (H2=130, H3=65 start, 30 iterations max)

### ⏳ In Progress
- **Enhanced Test** - Running with full adversarial tests and database verification

## After Enhanced Test Completes

### Step 1: Review Adversarial Test Results
Check that all 8 adversarial tests passed:
1. ✅ Invalid Certificate Handling
2. ✅ Protocol Downgrade Prevention
3. ✅ Certificate Rotation Recovery
4. ✅ Connection Flood Protection
5. ✅ Malformed Request Handling
6. ✅ Service Recovery After Error
7. ✅ TLS Version Downgrade Prevention
8. ✅ HTTP/3 to HTTP/2 Fallback

**Success Criteria**: Services recover gracefully from all adversarial scenarios

### Step 2: Review Database Verification Results
Check that:
- ✅ Users persist in auth.users (both port 5437 and 5433)
- ✅ Records persist in records.records
- ✅ Foreign key relationships work
- ✅ All test data persists correctly

**Success Criteria**: All database verifications pass

### Step 3: Run Rotation Suite (Push Limits)
**Configuration**:
- Start: H2=130, H3=65 req/s
- Increments: H2=+15, H3=+8 per iteration
- Max iterations: 30
- Drop threshold: 1.5%

**Command**:
```bash
bash scripts/rotation-suite.sh
```

**What it does**:
- Tests CA and leaf certificate rotation
- Finds absolute maximum request rate before errors
- Verifies zero-downtime rotation at high rates
- Includes wire-level packet capture

### Step 4: Run k6 Limit Tests
**Tests to run**:
1. **Persistence/Soak Test** - Long duration, stable rate
2. **Absolute Max Test** - Find max VUs, measure p90-p100, Little's Law

**Commands** (after creating/updating scripts):
- `k6 run scripts/load/k6-limit-test-comprehensive.js --mode persistence`
- `k6 run scripts/load/k6-limit-test-comprehensive.js --mode limit`

## Expected Timeline

1. **Enhanced Test**: ~5-10 minutes (with adversarial tests)
2. **Review Results**: ~5 minutes
3. **Rotation Suite**: ~30-60 minutes (depending on how far it pushes)
4. **k6 Limit Tests**: ~30-60 minutes

## Success Criteria

- ✅ All adversarial tests pass (services recover)
- ✅ All database verifications pass
- ✅ Rotation suite finds absolute limit (before errors)
- ✅ k6 limit tests complete with full metrics
- ✅ Zero-downtime maintained during rotation at high rates
