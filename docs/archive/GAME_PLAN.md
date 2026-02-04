# Game Plan: Baseline Testing → Error Resolution → Platform AI Integration

**Created:** 2026-01-30 21:30
**Status:** In Progress - Baseline run active

---

## Current Status

### ✅ Completed
1. **DB Migration** - Social roles (owner, admin, moderator, member) + WhatsApp-style timestamps/read receipts
2. **Python AI Rebuild** - New platform intelligence RPCs (AuctionHeat, SellerBuyerInsight, SocialNegotiationInsight)
3. **Baseline Run Started** - `/tmp/baseline-run-20260130-210720.log` (currently running k6 chaos tests)

### 🔄 In Progress
- **Baseline Test Suite** - Full preflight + 7 test suites (baseline, enhanced, adversarial, rotation, standalone, tls-mtls, social)
- **Live Monitoring** - `./scripts/monitor-baseline-live.sh`

---

## Phase 1: Complete Baseline Run & Error Cataloging

### Step 1.1: Monitor Baseline Run (Current)
```bash
# Live monitoring
./scripts/monitor-baseline-live.sh /tmp/baseline-run-20260130-210720.log

# Or tail the log
tail -f /tmp/baseline-run-20260130-210720.log
```

**Expected Duration:** 30-60 minutes (full preflight + 7 suites)

### Step 1.2: Catalog All Errors (After Completion)
```bash
# Generate error catalog
./scripts/analyze-and-catalog-errors.sh /tmp/baseline-run-20260130-210720.log

# Output: /tmp/error-catalog-YYYYMMDD-HHMMSS.md
```

**Deliverable:** Comprehensive error catalog with:
- Suite pass/fail summary
- Error categories (gRPC, HTTP, DB, TLS, timeouts, k6 load)
- Root causes
- Fix priorities (Critical → Performance → Known Limitations)

### Step 1.3: Review & Prioritize
- Identify **critical** errors (HTTP 5xx, DB failures, TLS issues)
- Document **expected** errors (gRPC port-forward on Colima)
- Note **performance** issues (k6 dropped iterations, timeouts)

---

## Phase 2: Systematic Error Resolution

### Priority 1: Critical Fixes
**Goal:** All services healthy, no 5xx errors, DB/cache connectivity

1. **HTTP/REST Failures**
   - Fix any unexpected 4xx/5xx errors
   - Verify all endpoints return expected status codes
   - Check: auth, records, listings, social, shopping, analytics

2. **Database Connectivity**
   - Ensure all 8 DBs accessible (ports 5433-5440)
   - Verify schema migrations applied
   - Check connection pooling

3. **TLS/Certificate Issues**
   - Fix any cert mismatches
   - Verify CA chain
   - Ensure strict TLS works post-rotation

**Test After Fixes:**
```bash
./scripts/run-baseline-and-log.sh
# Compare with previous run
./scripts/analyze-baseline-log.sh /tmp/baseline-run-NEW.log /tmp/baseline-run-20260130-210720.log
```

### Priority 2: Performance & Load
**Goal:** k6 chaos tests pass, dropped iterations < 1.5%

1. **k6 Chaos Test Thresholds**
   - Analyze dropped iteration rates
   - Adjust capacity (scale pods) OR thresholds
   - Optimize slow endpoints

2. **Timeout Issues**
   - Increase timeouts for slow operations
   - Add caching where appropriate
   - Profile slow queries

### Priority 3: Known Limitations (Document Only)
**Goal:** Clear documentation, no fix needed

1. **gRPC Direct Health Checks on Colima**
   - Status: Expected limitation
   - Workaround: Use Envoy proxy (works) or Kind cluster
   - Document in Runbook.md

2. **Port-Forward Timeouts**
   - Status: Colima VM limitation
   - Workaround: Use NodePort for direct access
   - Document in Runbook.md

---

## Phase 3: Analytics Service → Python AI Pipeline

**Prerequisites:** Baseline tests passing, no critical errors

### Step 3.1: Analytics Service Integration
**File:** `services/analytics-service/src/grpc-client-python-ai.ts`

```typescript
// Add gRPC client for Python AI
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Load python-ai.proto
const PROTO_PATH = '/app/proto/python-ai.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const pythonAiProto = grpc.loadPackageDefinition(packageDefinition).python_ai;

// Create client
const pythonAiClient = new pythonAiProto.PythonAIService(
  'python-ai-service:50060',
  grpc.credentials.createSsl(/* TLS certs */)
);

// Platform-wide intelligence functions
export async function getAuctionHeat(auctionId: string, bidCount: number) {
  return new Promise((resolve, reject) => {
    pythonAiClient.AuctionHeat({ auction_id: auctionId, bid_count: bidCount }, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

export async function getSellerBuyerInsight(userId: string, role: 'seller' | 'buyer') {
  // Similar implementation
}

export async function getSocialNegotiationInsight(conversationId: string) {
  // Similar implementation
}
```

### Step 3.2: Data Pipeline (Analytics → Python AI)
**File:** `services/analytics-service/src/ai-pipeline.ts`

```typescript
// Stream analytics events to Python AI
export class AIPipeline {
  async processEvent(event: AnalyticsEvent) {
    switch (event.type) {
      case 'auction_bid':
        // Get AI-powered auction heat
        const heat = await getAuctionHeat(event.auctionId, event.bidCount);
        // Store insight, trigger alerts, etc.
        break;
      
      case 'user_activity':
        // Get seller/buyer intelligence
        const insight = await getSellerBuyerInsight(event.userId, event.role);
        break;
      
      case 'social_message':
        // Get negotiation psychology insight
        const negotiation = await getSocialNegotiationInsight(event.conversationId);
        break;
    }
  }
}
```

### Step 3.3: Service Integration Points

1. **Auction Monitor** → Python AI (AuctionHeat)
   - Real-time bid analysis
   - Heat score calculation
   - Urgency detection

2. **Shopping/Listings** → Python AI (SellerBuyerInsight)
   - Seller reputation analysis
   - Buyer behavior patterns
   - Price optimization

3. **Social Service** → Python AI (SocialNegotiationInsight)
   - Negotiation psychology
   - Communication patterns
   - Deal probability

### Step 3.4: Comprehensive Testing
**File:** `scripts/test-analytics-ai-pipeline.sh`

```bash
# Test analytics → Python AI integration
# 1. Send analytics events
# 2. Verify Python AI receives and processes
# 3. Check response times
# 4. Validate insights
# 5. Test under load (k6)
```

**Protocol-aware tests:**
- HTTP/2 and HTTP/3 for analytics ingestion
- gRPC for analytics → Python AI communication
- Strict TLS/mTLS throughout
- Packet capture verification

---

## Phase 4: Documentation & Commit

### Step 4.1: Update Documentation
1. **Runbook.md** - Add analytics-AI pipeline section
2. **ENGINEERING.md** - Document architecture, data flow
3. **COMMIT_MESSAGE.txt** - Summarize all changes

### Step 4.2: Final Verification
```bash
# Run full test suite one more time
./scripts/run-baseline-and-log.sh

# Analyze results
./scripts/analyze-baseline-log.sh /tmp/baseline-run-FINAL.log

# Compare with baseline
./scripts/analyze-baseline-log.sh /tmp/baseline-run-FINAL.log /tmp/baseline-run-20260130-210720.log
```

---

## Timeline & Checkpoints

### Checkpoint 1: Baseline Complete (ETA: 30-60 min)
- [ ] Baseline run finishes
- [ ] Error catalog generated
- [ ] Errors prioritized

### Checkpoint 2: Critical Fixes (ETA: +1-2 hours)
- [ ] All critical errors resolved
- [ ] Re-run baseline, verify fixes
- [ ] No 5xx errors, all DBs healthy

### Checkpoint 3: Analytics-AI Integration (ETA: +2-3 hours)
- [ ] gRPC client implemented
- [ ] Data pipeline working
- [ ] All 3 service integrations done
- [ ] Comprehensive tests passing

### Checkpoint 4: Documentation & Commit (ETA: +30 min)
- [ ] All docs updated
- [ ] Commit message written
- [ ] Final baseline run clean

---

## Monitoring Commands

```bash
# Live monitoring (run in separate terminal)
./scripts/monitor-baseline-live.sh

# Check progress
tail -f /tmp/baseline-run-20260130-210720.log

# Quick status
ls -lh /tmp/baseline-run-*.log
ps aux | grep "run-baseline\|run-all-test" | grep -v grep

# When complete
./scripts/analyze-and-catalog-errors.sh /tmp/baseline-run-20260130-210720.log
```

---

## Next Action

**RIGHT NOW:** Wait for baseline run to complete (~30-60 min), then:
1. Run error catalog script
2. Review errors
3. Start Phase 2 (systematic fixes)

**Monitor:** `./scripts/monitor-baseline-live.sh /tmp/baseline-run-20260130-210720.log`
