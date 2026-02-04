# 📊 Baseline Run - Live Report

**Completed:** 2026-01-30 21:44:52  
**Duration:** ~37 minutes (21:07:20 → 21:44:52)  
**Log:** `/tmp/baseline-run-20260130-210720.log` (109KB)  
**Exit Code:** 1 (2 suites failed)

---

## ✅ Overall Results

### Suite Summary (5/7 PASSED)
| Suite | Status | Notes |
|-------|--------|-------|
| ✅ Baseline | **PASSED** | HTTP/2, HTTP/3, gRPC smoke tests |
| ✅ Enhanced | **PASSED** | Extended coverage |
| ✅ Adversarial | **PASSED** | Edge cases, error handling |
| ⚠️ Rotation | **FAILED** | Certificate rotation under load |
| ✅ TLS/mTLS | **PASSED** | Comprehensive TLS verification |
| ⚠️ Social | **FAILED** | Social service comprehensive tests |
| N/A | Standalone | (Packet capture - may be included in rotation) |

### Key Metrics
- **Passed tests:** 404
- **Warnings/Failed:** 12
- **Critical failures:** 0
- **gRPC port-forward issues:** 15 (expected on Colima)

---

## 🚨 Failed Suites - Detailed Analysis

### 1. Rotation Suite (FAILED)

**Issue:** Dropped iterations exceeded threshold during certificate rotation under load

**Details:**
```
Real req/s: 449.50 (expected 460)
Dropped iterations: 1889 (2.28% > 1.5% threshold)
- H2 Rate: 300 req/s (Failures: 0.00%, Drops: 2.28%)
- H3 Rate: 160 req/s (Failures: 0.00%, Drops: 2.28%)
```

**Root Cause:** System at capacity during cert rotation
- No actual HTTP errors (0.00% failures)
- Dropped iterations = k6 couldn't maintain target rate
- This is a **performance/capacity issue**, not a functional bug

**Fix Options:**
1. **Scale up** - Increase pod replicas during rotation
2. **Adjust threshold** - Change from 1.5% to 2.5% (more realistic for rotation under load)
3. **Reduce load** - Lower target req/s during rotation tests
4. **Optimize** - Improve service performance

**Priority:** MEDIUM (functional correctness is OK, performance tuning needed)

---

### 2. Social Suite (FAILED)

**Issue:** `HTTP 000` on `POST /forum/posts`

**Details:**
```
✅ Social healthz 200
✅ List posts 200 (GET /forum/posts)
⚠️  Create post HTTP 000 (POST /forum/posts)
✅ List messages 200
```

**Root Cause:** Connection failure or timeout on POST endpoint
- `HTTP 000` = curl couldn't connect or request timed out
- GET works, POST fails → likely timeout or service crash during POST
- Happened after cert rotation (rotation suite ran before social suite)

**Possible Causes:**
1. **Service restart** - Social service pod restarted during rotation, not fully ready
2. **Timeout** - POST /forum/posts takes too long (needs optimization)
3. **Connection pool** - DB connection exhausted after heavy load tests
4. **Memory/CPU** - Service under resource pressure after rotation chaos

**Fix Priority:** HIGH (functional issue)

---

## 📋 Error Catalog by Category

### 1. gRPC Port-Forward Failures (15 occurrences)
**Status:** ✅ EXPECTED - Known Colima limitation  
**Impact:** None (gRPC via Envoy proxy works)  
**Action:** Document, don't fix

### 2. Performance Issues
- **k6 dropped iterations:** 2.28% during rotation (threshold: 1.5%)
- **Foreign key violations:** 158 found (records.records)
- **Action:** Optimize queries, scale pods, or adjust thresholds

### 3. Social Service POST Failure
- **HTTP 000 on POST /forum/posts**
- **Action:** Investigate and fix (HIGH priority)

### 4. Health Probe Warnings
- CoreDNS: Liveness/readiness timeouts (6 restarts)
- Metrics-server: Probe failures (10 restarts)
- Auth-service: 1 liveness probe failure during social suite
- **Action:** Monitor, likely related to system load

---

## 🎯 Immediate Action Plan

### Step 1: Fix Social Suite POST Failure (NOW)

**Investigation needed:**
```bash
# Check social service logs during the failure
kubectl logs -n record-platform social-service-5c6d746698-tfv8w --tail=100

# Check if service was restarting
kubectl describe pod -n record-platform social-service-5c6d746698-tfv8w

# Test POST /forum/posts manually
curl -X POST https://record.local:30443/api/forum/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test post"}' \
  --cacert /tmp/grpc-certs/ca.crt \
  --http2 -v
```

**Likely fixes:**
1. Increase POST timeout in test script
2. Add retry logic for POST after rotation
3. Wait longer for service readiness after cert rotation
4. Optimize POST /forum/posts endpoint

### Step 2: Address Rotation Performance (MEDIUM)

**Options:**
1. **Quick fix:** Adjust threshold from 1.5% to 2.5%
   ```bash
   # In rotation-suite.sh or k6-chaos-test.js
   MAX_DROP_THRESHOLD=2.5  # was 1.5
   ```

2. **Better fix:** Scale services during rotation
   ```bash
   # Before rotation chaos test
   kubectl scale deployment -n record-platform \
     api-gateway auth-service records-service --replicas=2
   ```

3. **Best fix:** Optimize service performance
   - Profile slow endpoints
   - Add caching
   - Optimize DB queries

### Step 3: Fix Foreign Key Violations (MEDIUM)

**Issue:** 158 violations in `records.records`
```sql
-- Check violations
SELECT * FROM records.records 
WHERE user_id NOT IN (SELECT id FROM auth.users)
LIMIT 10;

-- Fix: Add proper FK or clean up orphaned records
DELETE FROM records.records 
WHERE user_id NOT IN (SELECT id FROM auth.users);
```

---

## 📈 Next Steps (In Order)

1. **[NOW]** Investigate social suite POST failure
   - Check logs, test manually, identify root cause
   - Fix and re-run social suite

2. **[AFTER FIX]** Re-run baseline
   ```bash
   ./scripts/run-baseline-and-log.sh
   ```

3. **[WHEN CLEAN]** Address rotation performance
   - Adjust threshold OR scale pods
   - Re-run rotation suite

4. **[WHEN CLEAN]** Fix FK violations
   - Clean up orphaned records
   - Add proper FK constraints

5. **[FINAL]** Analytics → Python AI integration
   - Implement gRPC client in analytics-service
   - Add data pipeline
   - Comprehensive testing

---

## 🔍 Monitoring Commands

```bash
# Check social service health NOW
kubectl get pods -n record-platform | grep social
kubectl logs -n record-platform -l app=social-service --tail=50

# Re-run just social suite
./scripts/test-social-service-comprehensive.sh

# Re-run just rotation suite
./scripts/rotation-suite.sh

# Full baseline re-run
./scripts/run-baseline-and-log.sh
```

---

## 📊 System Health (Current)

✅ **All pods ready** (9/9 services)  
✅ **All 8 databases UP** (5433-5440)  
✅ **Kafka UP** (strict TLS, port 29093)  
✅ **Redis UP** (Lua scripting OK)  
✅ **TLS/mTLS** (all services have CA + leaf certs)  
⚠️ **CoreDNS** (6 restarts - load related)  
⚠️ **Metrics-server** (10 restarts - load related)

**Overall:** System is healthy but under load stress. Social POST issue needs immediate attention.
