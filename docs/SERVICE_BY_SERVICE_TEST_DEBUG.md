# Service-by-Service Test Debug Guide

This document helps diagnose failing tests from `scripts/test-microservices-http2-http3.sh` and the k6 chaos job. Run each service's checks when its tests fail.

## Quick Reference: Failed Tests → Service

| Test(s) | Service | Endpoint | DB/Port |
|---------|---------|----------|---------|
| 7c, 7d | Social | Vote on forum post (gRPC) | forum.post_votes (5434 social) |
| 12f, 12i | Listings | PUT /api/listings/settings | listings.user_settings (5435) |
| 12g, 12g2 | Listings | POST /api/listings/:id/images | listings.listing_images (5435) |
| 13f2, 13j4b | Listings | POST /api/listings/ratings | listings.ratings (5435) |
| 13j8 | Shopping | POST /api/resell/:purchaseId | shopping.purchase_history (5436) |
| 13k, 13k2 | Analytics | POST /api/analytics/log-search | listings.search_history (5433 records) |
| 13m, 13m2 | Python AI | POST /api/ai/selling-advice | ai.inference_log (5440) |
| k6 chaos exit 107 | k6 | xk6-http3 / TLS / OOM | N/A |

---

## Social Service (Tests 7c, 7d — forum.post_votes)

**Symptom:** Vote works (200) but DB has no row in `forum.post_votes`.

**Checks:**
```bash
# 1. Verify social gRPC VotePost writes to DB
kubectl -n record-platform logs -l app=social-service --tail=50 | grep -i vote

# 2. After a vote, check DB (social DB on 5434 has forum schema)
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d social -c \
  "SELECT * FROM forum.post_votes ORDER BY created_at DESC LIMIT 5;"

# 3. Ensure social-service uses social DB (POSTGRES_URL_SOCIAL → 5434)
kubectl -n record-platform get deploy social-service -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .
```

**Fix applied:** gRPC `VotePost` / `VoteComment` in `services/social-service/src/grpc-server.ts` now INSERT into `forum.post_votes` / `forum.comment_votes`. Rebuild and redeploy social-service.

---

## Listings Service (12f, 12g, 12i, 13f2, 13j4b)

### 12f/12i — PUT /api/listings/settings (404)

**Checks:**
```bash
# 1. Gateway routes to listings-service /settings
kubectl -n record-platform logs -l app=api-gateway --tail=100 | grep -i "listings.*settings"

# 2. Listings-service mounts settings router at /settings
# See services/listings-service/src/server.ts: app.use("/settings", settingsRouter)

# 3. Settings router uses POSTGRES_URL_LISTINGS (not POSTGRES_URL)
grep -r "POSTGRES_URL" services/listings-service/src/settings.ts
```

**Fix applied:** Gateway has explicit `PUT /listings/settings` and `PUT /api/listings/settings` → `/settings`. Settings pool uses `POSTGRES_URL_LISTINGS`.

### 12g/12g2 — POST /api/listings/:id/images (500)

**Checks:**
```bash
# 1. Response body (run test with CAPTURE_RESPONSE=1)
# Look for "column \"file_name\" does not exist" or validation error

# 2. Schema: listings.listing_images has no file_name column
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -c \
  "\d listings.listing_images"

# 3. Listings-service logs
kubectl -n record-platform logs -l app=listings-service --tail=100 | grep -i image
```

**Fix applied:** Removed `file_name` from `addListingImage` INSERT (schema has no such column). Added `image_url` validation.

### 13f2 — POST /api/listings/ratings (502)

**Checks:**
```bash
# 1. Gateway proxy error?
kubectl -n record-platform logs -l app=api-gateway --tail=100 | grep -i ratings

# 2. Listings-service receives request?
kubectl -n record-platform logs -l app=listings-service --tail=100 | grep -i rating

# 3. ratings table exists
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -c \
  "SELECT 1 FROM listings.ratings LIMIT 1;"
```

**Fix applied:** Explicit `POST /listings/ratings` and `POST /api/listings/ratings` → `/ratings`.

### 13j4b — Rate seller HTTP/3 (404)

**Possible cause:** Caddy/HTTP3 routing. `@api` matcher: `^/(api/|auth/|records/|listings/|...|shopping/|...)` — `/api/listings/ratings` matches. If 404 persists, compare HTTP/2 vs HTTP/3 path (Host, port, SNI).

---

## Shopping Service (13j8 — Resell HTTP/3 404)

**Checks:**
```bash
# 1. Resell route: POST /api/resell/:purchaseId
# Gateway: app.use("/resell", ...) pathRewrite sends /resell/:id to shopping-service
# Shopping: app.use('/resell', resellRouter) — POST /:purchaseId

# 2. Caddy @api matcher includes /api/ — /api/resell/xxx should match
# Verify HTTP/3 request reaches api-gateway
kubectl -n record-platform logs -l app=api-gateway --tail=200 | grep -i resell

# 3. Shopping receives?
kubectl -n record-platform logs -l app=shopping-service --tail=100 | grep -i resell

# 4. Purchase ID valid? Must have resellable=true
PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -c \
  "SELECT id, user_id, resellable FROM shopping.purchase_history WHERE resellable = TRUE LIMIT 3;"
```

---

## Analytics Service (13k, 13k2 — log-search 500)

**Root cause:** `listings.search_history` lives in **records DB (5433)**, not listings DB (5435). See `infra/db/03-database.sql` and `docs/CURRENT_DB_SCHEMA_REPORT.md`.

**Fix applied:** Analytics `logSearch` and all search_history reads now use `recordsPool` (POSTGRES_URL_RECORDS). Also: test script sends `"userId":"${USER1_ID:-null}"` which becomes the string `"null"` when USER1_ID is unset — we coerce that to SQL NULL.

**Checks:**
```bash
# 1. listings.search_history exists in records DB (5433)
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c \
  "\d listings.search_history"

# 2. Analytics has POSTGRES_URL_RECORDS
kubectl -n record-platform get deploy analytics-service -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .

# 3. Analytics logs
kubectl -n record-platform logs -l app=analytics-service --tail=100 | grep -i "log search\|search_history"
```

---

## Python AI Service (13m, 13m2 — selling-advice 500)

**Fix applied:** `_coerce_user_id` in ai_main.py converts `"null"` string to None. `log_inference` in db.py validates user_id and passes None for invalid values (avoids `$1::uuid` with string `"null"`).

**Checks:**
```bash
# 1. ai.inference_log exists (python_ai DB on 5440)
PGPASSWORD=postgres psql -h localhost -p 5440 -U postgres -d python_ai -c \
  "\d ai.inference_log"

# 2. Python AI logs (look for exception details)
kubectl -n record-platform logs -l app=python-ai-service --tail=100 | grep -i "selling\|error\|exception"

# 3. DB connection (POSTGRES_URL_PYTHON_AI)
kubectl -n record-platform get deploy python-ai-service -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .
```

---

## k6 Chaos Job — Exit 107

**Meaning:** k6 script exception at load/init (script never ran).

**Checks:**
```bash
# 1. Job logs (exact error)
kubectl -n k6-load logs job/k6-chaos-<id> 2>&1 | tail -80

# 2. Pod status (OOMKilled?)
kubectl -n k6-load describe pod -l job-name=k6-chaos-<id>

# 3. Common causes
# - xk6-http3 extension missing: script uses import http3 from "k6/x/http3"
#   Fix: ./scripts/build-k6-image.sh (rebuild k6 with xk6-http3)
# - k6-ca-cert ConfigMap missing/empty (strict TLS)
# - OOM: increase memory in run-k6-chaos.sh
# - Remote import (jslib): script uses inline summary; no network at load — should not apply
```

**Quick fix:**
```bash
./scripts/build-k6-image.sh
# Ensure k6-load namespace has k6-ca-cert ConfigMap
kubectl -n k6-load get configmap k6-ca-cert -o yaml
```

---

## Social HTTP/3 Health Check — 503 (Test 16c)

**Symptom:** `GET /api/social/healthz` via HTTP/3 returns 503.

**Root cause:** Social-service's `/healthz` intentionally returns 503 when unhealthy. In `services/social-service/src/server.ts`:

- **DB disconnected:** If `pool.query('SELECT 1')` fails or times out (2s), `status.db = 'disconnected'`, `status.ok = false` → 503
- **Overall timeout:** If the full health check exceeds 3s, it returns 503

**When this happens:**
1. **DB under load** — Baseline + enhanced run back-to-back; social DB (port 5434) may be slow
2. **Postgres not ready** — Docker compose or k8s postgres not started
3. **Connection pool exhausted** — High concurrency, pool not sized for load

**Checks:**
```bash
# 1. Response body (tells you db/redis status)
curl -sS -w "\n%{http_code}" --resolve record.local:443:$TARGET_IP \
  https://record.local/api/social/healthz | tail -5
# Expect: {"ok":true,"db":"connected","redis":"..."} 200
# If 503: {"ok":false,"db":"disconnected"|"timeout",...} 503

# 2. Social DB reachable?
PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p 5434 -U postgres -d social -c "SELECT 1;"

# 3. Social-service logs (DB errors)
kubectl -n record-platform logs -l app=social-service --tail=80 | grep -iE "DB|health|error"
```

**Mitigations:**
- Run `ensure-pgbench-dbs-ready.sh` before suites so all 8 Postgres are up
- Add a short settle/sleep between baseline and enhanced (enhanced already has 5s)
- If persistent: check social DB CPU, connection count, slow queries

---

## Enhanced Suite — Timeouts, 503, Flakiness

**Symptom:** Enhanced suite fails with timeouts, 503s, or inconsistent results.

**Root causes:**
1. **Per-test packet capture churn** — Without `CAPTURE_SKIP_PER_TEST=1`, each test runs `kubectl exec` to install tcpdump in 2 Caddy + 1 Envoy pods (~25s per pod). On Colima this creates load and can cause timeouts.
2. **Back-to-back suite load** — Baseline finishes; enhanced starts immediately. DBs (especially social, records) may still be under load from baseline verification.
3. **HTTP/3 curl 55** — QUIC send failure; see `docs/HTTP3-CURL-EXIT-CODES.md`. Try `NGTCP2_ENABLE_GSO=0`, ensure LB IP is reachable.

**Checks:**
```bash
# 1. Use suite-level capture (faster, more stable on Colima)
CAPTURE_SKIP_PER_TEST=1 ./scripts/run-all-test-suites.sh

# 2. Increase timeouts for enhanced
ENHANCED_SUITE_TIMEOUT=600 SUITE_TIMEOUT=0 ./scripts/run-all-test-suites.sh

# 3. Settle before enhanced (script already does 5s; increase if needed)
# Edit test-microservices-http2-http3-enhanced.sh: sleep 10
```

---

## Capturing Response Bodies (Debug Mode)

Set `CAPTURE_FAILED_RESPONSE=1` when running the test script to print response bodies on failure:

```bash
CAPTURE_FAILED_RESPONSE=1 ./scripts/test-microservices-http2-http3.sh
```

This helps see exact error messages (e.g. `"details":"column \"file_name\" does not exist"`).
