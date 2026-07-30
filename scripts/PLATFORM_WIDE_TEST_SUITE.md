# Platform-Wide Comprehensive Test Suite

## Overview

This test suite provides comprehensive testing for analytics and python-ai services across the entire platform, including end-to-end workflows, protocol correctness, and adversarial scenarios.

## Test Structure

### Section 1: Protocol Correctness Tests

Tests gRPC, HTTP/2, and HTTP/3 with strict TLS verification.

#### Test 1.1: gRPC Health Checks (Strict TLS)
- **Purpose**: Verify gRPC services respond correctly with strict TLS (mTLS)
- **Services Tested**: auth-service, messaging-service, listings-service, analytics-service, python-ai-service, auction-monitor
- **What It Does**: 
  - Executes `grpc-health-probe` inside each service pod
  - Uses strict TLS verification (`-tls-no-verify=false`)
  - Validates CA certificate chain
  - Ensures server name matches (`record.local`)
- **Success Criteria**: All services return healthy status

#### Test 1.2: HTTP/2 Protocol (Strict TLS)
- **Purpose**: Verify HTTP/2 works correctly with strict TLS
- **What It Does**:
  - Uses `curl --http2-prior-knowledge` to force HTTP/2
  - Tests all service health endpoints via Caddy
  - Validates TLS certificate chain using CA certificate
  - Ensures no curl exit code 60 (certificate verification failure)
- **Endpoints Tested**: `/api/auth/health`, `/api/analytics/healthz`, `/api/python-ai/healthz`, `/api/auction-monitor/healthz`, `/api/social/healthz`, `/api/listings/healthz`, `/api/shopping/healthz`
- **Success Criteria**: All endpoints return 200 or 404 (service-specific)

#### Test 1.3: HTTP/3 Protocol (QUIC, Strict TLS)
- **Purpose**: Verify HTTP/3 (QUIC) works correctly with strict TLS
- **What It Does**:
  - Uses `http3_curl` to test QUIC protocol
  - Tests same endpoints as HTTP/2
  - Validates UDP-based QUIC transport
  - Ensures TLS 1.3 handshake over QUIC
- **Success Criteria**: All endpoints return 200 or 404

#### Test 1.4: ALPN Protocol Negotiation
- **Purpose**: Verify Application-Layer Protocol Negotiation (ALPN) works
- **What It Does**:
  - Tests that Caddy correctly negotiates HTTP/2 via ALPN
  - Validates protocol upgrade from HTTP/1.1 to HTTP/2
- **Success Criteria**: HTTP/2 successfully negotiated

---

### Section 2: End-to-End Workflows

Tests complete user journeys across multiple services.

#### Test 2.1: Auction Monitor → Analytics → Python AI Pipeline

**Purpose**: Test the complete data pipeline from auction ingestion to AI-generated user plans.

**What It Does**:
1. **Auction Monitor Ingestion**:
   - Sends auction data (eBay format) to `/api/auction-monitor/monitor`
   - Includes: source, query, item details (title, price, currency, end time)
   - Validates data is accepted and stored

2. **Analytics Processing**:
   - Waits for pipeline processing (2 seconds)
   - Queries `/api/analytics/recommendations/similar` with the auction query
   - Validates analytics service processes the auction data
   - Checks that percentiles (p1-p100) are calculated
   - Ensures data quality for Python AI consumption

3. **Python AI Plan Generation**:
   - Sends selling advice request to `/api/ai/selling-advice`
   - Includes: query, record grade, sleeve grade, user ID, current price
   - Validates AI generates a recommended price
   - Checks that strategy/recommendations are provided
   - Ensures plan is actionable for the user

**Success Criteria**: All three steps complete successfully, data flows through the pipeline

**Use Case**: User monitors an auction, analytics processes the data, AI provides a buying/selling plan

---

#### Test 2.2: Messaging Service - Negotiation Helper

**Purpose**: Test messaging-plane's ability to determine next negotiation tone based on context.

**What It Does**:
- Sends negotiation advice request to `/api/ai/negotiation-advice`
- Includes: query, role (buyer/seller), current price, target price, user ID
- Validates response includes:
  - `strategy`: Negotiation strategy (firm, moderate, flexible)
  - `negotiation_stance`: Recommended approach
  - Price range recommendations
  - Talking points

**Success Criteria**: Response includes strategy and negotiation stance

**Use Case**: User is negotiating a price, AI determines the best tone and approach based on market data and user context

---

#### Test 2.3: Listings Service - Profit Maximization (Sellers)

**Purpose**: Test listings service's ability to help sellers maximize profit using past price history and Discogs integration.

**What It Does**:
1. **Price History Retrieval**:
   - Queries `/api/analytics/price-trend` with a record query
   - Validates Discogs integration returns historical prices
   - Checks for price percentiles (p1-p100)

2. **Selling Advice**:
   - Sends selling advice request to `/api/ai/selling-advice`
   - Includes: query, record grade, sleeve grade, user ID, current price
   - Validates response includes:
     - `recommended_price`: Optimal listing price
     - Profit maximization recommendations
     - Market positioning advice

**Success Criteria**: Both price history and selling advice are provided

**Use Case**: Seller wants to list a record, service provides optimal pricing based on historical data and market trends

---

#### Test 2.4: Shopping Service - Shopper Experience

**Purpose**: Test shopping service functionality for buyers.

**What It Does**:
- Tests shopping service health check at `/api/shopping/healthz`
- Validates service is responsive
- (Note: Full shopping tests require authentication, so health check is the baseline)

**Success Criteria**: Health check returns 200

**Use Case**: Shopper browsing the platform, service is available and responsive

---

### Section 3: Adversarial Tests

Tests system resilience under adverse conditions.

#### Test 3.1: Invalid Input Handling

**Purpose**: Verify services properly reject invalid input.

**What It Does**:
- Sends malformed JSON to `/api/ai/selling-advice`
- Includes missing required fields
- Validates service returns 400 (Bad Request) or 422 (Unprocessable Entity)
- Ensures no 500 errors from invalid input

**Success Criteria**: Service returns 400/422, not 500

**Use Case**: Malicious or accidental invalid requests are handled gracefully

---

#### Test 3.2: Large Payload Handling

**Purpose**: Verify services handle large payloads correctly.

**What It Does**:
- Sends a 5KB query string to `/api/analytics/log-search`
- Tests service's ability to handle oversized input
- Validates service either:
  - Accepts and processes (if within limits)
  - Rejects with 400 (Bad Request)
  - Rejects with 413 (Payload Too Large)

**Success Criteria**: Service handles large payload appropriately (accept or reject gracefully)

**Use Case**: User accidentally pastes large text, service doesn't crash

---

#### Test 3.3: Concurrent Request Handling

**Purpose**: Verify services handle concurrent requests correctly.

**What It Does**:
- Sends 10 concurrent requests to `/api/analytics/healthz`
- Tests connection pool management
- Validates no connection errors or timeouts
- Ensures all requests complete successfully

**Success Criteria**: All concurrent requests succeed

**Use Case**: Multiple users accessing the service simultaneously, no connection pool exhaustion

---

## Prerequisites

**Environment**: Colima + k3s (not Kind)
- Colima should be running: `colima status`
- k3s API server should be ready: `kubectl get nodes`
- Context should be set: `kubectl config use-context colima`

**Strict TLS Configuration**:
- All services should have `GRPC_REQUIRE_CLIENT_CERT=true` (production mode)
- CA certificates should be issued: `pnpm run reissue` or `./scripts/reissue-ca-and-leaf-load-all-services.sh`
- Health probes should verify server certs (`-tls-no-verify=false`)

## Usage

### Bash Test Suite

```bash
# Run all tests (requires Colima/k3s)
./scripts/run-platform-wide-test-suite.sh

# Run only protocol tests
PROTOCOL_TEST_ONLY=1 ./scripts/run-platform-wide-test-suite.sh

# Run only E2E workflows
E2E_ONLY=1 ./scripts/run-platform-wide-test-suite.sh

# Run only adversarial tests
ADVERSARIAL_ONLY=1 ./scripts/run-platform-wide-test-suite.sh

# Skip specific sections
SKIP_PROTOCOL=1 ./scripts/run-platform-wide-test-suite.sh
SKIP_E2E=1 ./scripts/run-platform-wide-test-suite.sh
SKIP_ADVERSARIAL=1 ./scripts/run-platform-wide-test-suite.sh

# Allow non-Colima context (not recommended)
REQUIRE_COLIMA=0 ./scripts/run-platform-wide-test-suite.sh
```

### k6 Load Test

```bash
# Full platform test (50 VUs, 10 minutes)
k6 run --vus 50 --duration 10m scripts/load/k6-platform-wide-comprehensive.js

# E2E workflows only
E2E_ONLY=1 k6 run --vus 20 --duration 5m scripts/load/k6-platform-wide-comprehensive.js

# Protocol tests only
PROTOCOL_ONLY=1 k6 run --vus 10 --duration 2m scripts/load/k6-platform-wide-comprehensive.js

# Adversarial tests only
ADVERSARIAL_ONLY=1 k6 run --vus 30 --duration 3m scripts/load/k6-platform-wide-comprehensive.js

# Custom configuration
BASE_URL=https://record.local:30443 HOST=record.local \
  k6 run --vus 100 --duration 15m scripts/load/k6-platform-wide-comprehensive.js
```

## Test Results

Results are saved to:
- Bash suite: `/tmp/platform-test-results-YYYYMMDD-HHMMSS/`
  - `results.json`: JSON format with all test results
  - `summary.txt`: Human-readable summary
- k6 suite: Console output + `summary.json` file

## Service Breakdown

### Analytics Service
- **Role**: Processes auction data, calculates percentiles (p1-p100), provides recommendations
- **Endpoints Tested**: `/api/analytics/recommendations/similar`, `/api/analytics/price-trend`, `/api/analytics/log-search`
- **What It Does**: Ingests data from auction monitor, calculates statistical metrics, prepares data for Python AI

### Python AI Service
- **Role**: Generates user plans, provides advice (selling, buying, negotiation, bidding)
- **Endpoints Tested**: `/api/ai/selling-advice`, `/api/ai/negotiation-advice`, `/api/ai/buying-advice`, `/api/ai/bidding-advice`
- **What It Does**: Uses analytics data to provide actionable recommendations for users

### Auction Monitor Service
- **Role**: Ingests auction data from external sources (eBay, etc.)
- **Endpoints Tested**: `/api/auction-monitor/monitor`
- **What It Does**: Receives auction listings, normalizes data, sends to analytics pipeline

### Messaging Service
- **Role**: Forum and messaging, negotiation context
- **Endpoints Tested**: `/api/social/healthz` (indirectly via negotiation advice)
- **What It Does**: Provides context for negotiation helper (determines next tone)

### Listings Service
- **Role**: Manages listings, price history, Discogs integration
- **Endpoints Tested**: `/api/listings/healthz` (indirectly via price history)
- **What It Does**: Provides past price history for profit maximization

### Shopping Service
- **Role**: Shopping cart, wishlist, purchase history
- **Endpoints Tested**: `/api/shopping/healthz`
- **What It Does**: Manages shopper experience (cart, wishlist, orders)

## Protocol Details

### gRPC (Strict TLS)
- **Port**: 50051 (internal)
- **TLS**: Required, with CA certificate verification
- **mTLS**: Optional (controlled by `GRPC_REQUIRE_CLIENT_CERT` env var)
- **Health Check**: `grpc-health-probe` with TLS flags

### HTTP/2
- **Port**: 443 (via Caddy), 30443 (NodePort)
- **TLS**: Required, strict verification
- **ALPN**: `h2` protocol negotiation
- **Testing**: `curl --http2-prior-knowledge`

### HTTP/3 (QUIC)
- **Port**: 443 (UDP, via Caddy)
- **TLS**: Required, TLS 1.3 over QUIC
- **Transport**: UDP-based QUIC protocol
- **Testing**: `http3_curl` (if available)

## Troubleshooting

### Protocol Tests Fail
- **Issue**: curl exit code 60 (certificate verification failure)
- **Solution**: Run `pnpm run reissue` or `./scripts/reissue-ca-and-leaf-load-all-services.sh`
- **Check**: Ensure CA certificate matches Caddy certificate

### E2E Pipeline Fails
- **Issue**: Analytics or AI service returns 500
- **Solution**: Check service logs: `kubectl -n record-platform logs -l app=analytics-service`
- **Check**: Verify database connectivity and Kafka availability

### Adversarial Tests Fail
- **Issue**: Services crash on invalid input
- **Solution**: Review input validation in service code
- **Check**: Ensure proper error handling and status codes

## Next Steps

1. **Add Authentication**: Extend tests to include authenticated requests (JWT tokens)
2. **Database Validation**: Add tests that verify data persistence in databases
3. **Kafka Integration**: Test event streaming through Kafka topics
4. **Performance Baselines**: Establish latency and throughput baselines
5. **Chaos Engineering**: Add pod deletion, network partition tests
