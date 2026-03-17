# Service-by-Service Test Debug Playbook

This doc explains how to investigate and fix failures from `scripts/test-microservices-http2-http3.sh` and the k6 chaos suite. Run tests with `TEST_DEBUG=1` to capture response bodies on failure.

## Quick Reference: Test → Service → Endpoint

| Test(s) | Service | Endpoint | DB/Schema |
|---------|---------|----------|-----------|
| 7c, 7d | Social | gRPC VotePost | forum.post_votes (5434) |
| 12f, 12i | Listings | PUT /settings | listings.user_settings (5435) |
| 12g, 12g2 | Listings | POST /listings/:id/images | listings.listing_images (5435) |
| 12h | Listings | POST /listings/:id/offer | listings.offers (5435) |
| 13f2, 13j4b | Listings | POST /ratings | listings.ratings (5435) |
| 13j8 | Shopping | POST /resell/:purchaseId | shopping.purchase_history, listings.listings |
| 13k, 13k2 | Analytics | POST /analytics/log-search | listings.search_history (5433/records) |
| 13m, 13m2 | Python AI | POST /api/ai/selling-advice | ai.inference_log (5440) |
| k6 chaos | k6 job | GET /_caddy/healthz | N/A (exit 107 = script load failure) |

---

## 1. Social Service — Forum post votes (7c, 7d)

**Symptom:** HTTP 200 but DB check fails (no row in forum.post_votes).

**Cause:** gRPC VotePost was a stub. **Fix:** Implemented in `services/social-service/src/grpc-server.ts` to INSERT into forum.post_votes.

**Debug:**
```bash
# Verify vote row exists
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d social -c \
  "SELECT * FROM forum.post_votes ORDER BY created_at DESC LIMIT 5"

# Check social-service logs
kubectl -n record-platform logs -l app=social-service --tail=100
```

---

## 2. Listings Service — Settings (12f, 12i)

**Symptom:** HTTP 404.

**Cause:** Gateway pathRewrite did not route /listings/settings to listings-service /settings. **Fix:** Explicit routes in api-gateway for PUT /listings/settings and POST /listings/ratings.

**Debug:**
```bash
# Direct hit (bypass gateway)
curl -sS -X PUT "http://localhost:4003/settings" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"country_code":"US","currency":"USD"}' -w "\n%{http_code}"

# Gateway hit
curl -sS -X PUT "https://$HOST:$PORT/api/listings/settings" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"country_code":"US","currency":"USD"}' -w "\n%{http_code}"

# Verify settings row
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -c \
  "SELECT * FROM listings.user_settings LIMIT 5"
```

---

## 3. Listings Service — Add image (12g, 12g2)

**Symptom:** HTTP 500.

**Cause:** `addListingImage` inserted `file_name` but `listings.listing_images` has no `file_name` column. **Fix:** Removed file_name from INSERT in `services/listings-service/src/lib/db.ts`.

**Debug:**
```bash
# Check listings-service logs for DB error
kubectl -n record-platform logs -l app=listings-service --tail=50

# Verify schema
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -c "\d listings.listing_images"

# Test directly (need valid LISTING_ID owned by user)
curl -sS -X POST "http://localhost:4003/listings/$LISTING_ID/images" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"image_url":"https://example.com/test.jpg","display_order":0,"is_primary":true}' -w "\n%{http_code}"
```

---

## 4. Listings Service — Ratings (13f2, 13j4b)

**Symptom:** HTTP 502 (H2) or 404 (H3).

**Cause:** Gateway needs explicit POST /listings/ratings route (done). H3 404 may be Caddy/ingress path handling.

**Debug:**
```bash
# Need PURCHASE_ID from checkout; LISTING_ID for the listing
curl -sS -X POST "https://$HOST:$PORT/api/listings/ratings" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"listing_id\":\"$LISTING_ID\",\"rating\":5,\"review_text\":\"Great!\",\"transaction_id\":\"$PURCHASE_ID\"}" -w "\n%{http_code}"

# Verify
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -c \
  "SELECT * FROM listings.ratings WHERE listing_id = '$LISTING_ID' LIMIT 3"

# Compare H2 vs H3: same Host, different port (H3 uses 443)
# If H3 404: check Caddy @api matcher includes /api/ paths; check HTTP/3 vs HTTP/2 routing
```

---

## 5. Shopping Service — Resell (13j8)

**Symptom:** HTTP 404 on HTTP/3.

**Cause:** Possibly Caddy routing for HTTP/3, or PURCHASE_ID_H3 not found (no resellable purchase).

**Debug:**
```bash
# Get resellable purchase ID from DB
PURCHASE_ID=$(PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping -tAc \
  "SELECT id FROM shopping.purchase_history WHERE user_id = '$USER1_ID' AND resellable = TRUE ORDER BY purchased_at DESC LIMIT 1")

# Test H2 and H3 with same purchase ID
curl -sS -X POST "https://$HOST:$PORT/api/resell/$PURCHASE_ID" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Resell Test","description":"Test","price":35,"currency":"USD","listing_type":"fixed_price","condition":"used","category":"vinyl","location":"US","shipping_cost":5,"mark_as_resold":true}' -w "\n%{http_code}"

# Check api-gateway logs for pathRewrite
kubectl -n record-platform logs -l app=api-gateway --tail=50 | grep resell
```

---

## 6. Analytics Service — Log search (13k, 13k2)

**Symptom:** HTTP 500.

**Cause:** `listings.search_history` lives in **records DB (5433)**, not listings DB (5435). Analytics used POSTGRES_URL_LISTINGS. **Fix:** Use POSTGRES_URL_RECORDS (recordsPool) for logSearch and search_history reads.

**Debug:**
```bash
# Verify table exists in records
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c \
  "SELECT 1 FROM listings.search_history LIMIT 1"

# Test directly
curl -sS -X POST "http://localhost:4004/analytics/log-search" \
  -H "Content-Type: application/json" \
  -d '{"source":"smoke-test","query":"debug-query-123","userId":null,"results":5}' -w "\n%{http_code}"

# Check analytics-service logs
kubectl -n record-platform logs -l app=analytics-service --tail=50
```

---

## 7. Python AI Service — Selling advice (13m, 13m2)

**Symptom:** HTTP 500.

**Cause:** user_id="null" (string) from test script → PostgreSQL $1::uuid fails. **Fix:** Coerce "null" to None in endpoint. Also: DB connection, Kafka, or analytics call can fail.

**Debug:**
```bash
# Test with explicit null (JSON)
curl -sS -X POST "http://localhost:5005/ai/selling-advice" \
  -H "Content-Type: application/json" \
  -d '{"query":"Blue Note vinyl","record_grade":"NM","sleeve_grade":"VG+","user_id":null,"current_price":45}' -w "\n%{http_code}"

# Test with valid user_id
curl -sS -X POST "http://localhost:5005/ai/selling-advice" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"Blue Note vinyl\",\"record_grade\":\"NM\",\"sleeve_grade\":\"VG+\",\"user_id\":\"$USER1_ID\",\"current_price\":45}" -w "\n%{http_code}"

# Check Python AI logs (includes exception details)
kubectl -n record-platform logs -l app=python-ai-service --tail=80

# Verify ai.inference_log
PGPASSWORD=postgres psql -h localhost -p 5440 -U postgres -d python_ai -c \
  "SELECT id, inference_type, query, user_id FROM ai.inference_log ORDER BY created_at DESC LIMIT 5"
```

---

## 8. k6 Chaos Job — Exit 107

**Symptom:** Job fails with exit 107; pod shows Failed/Error.

**Cause:** Exit 107 = k6 script exception at **load/init** (script never runs). Common causes:
1. **xk6-http3** not built into k6 image → `import http3 from "k6/x/http3"` fails
2. **OOMKilled** → increase memory limit (default 1Gi)
3. **k6-ca-cert** ConfigMap missing/empty → TLS verification fails
4. **jslib remote import** (if K6_USE_JSLIB=1) → no egress to jslib.k6.io

**Debug:**
```bash
# Get job/pod name
kubectl -n k6-load get job,pods -l job-name=k6-chaos-<id>

# Inspect pod
kubectl -n k6-load describe pod <pod-name>

# Check if OOMKilled
kubectl -n k6-load get pod <pod-name> -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}'

# View logs (shows GoError or script exception)
kubectl -n k6-load logs job/k6-chaos-<id>

# Rebuild k6 image with xk6-http3
./scripts/build-k6-image.sh

# Ensure ConfigMap exists
kubectl -n k6-load get configmap k6-ca-cert -o yaml
```

**Docs:** `scripts/ROTATION-SUITE-DEPENDENCIES.md` (exit 107 section), `scripts/k6-chaos-test.js` (inline summary, no jslib).

---

## Capturing Response Bodies on Failure

Set `TEST_DEBUG=1` when running the test script to write failed responses to `/tmp/test-microservices-debug-*.json`:

```bash
TEST_DEBUG=1 ./scripts/test-microservices-http2-http3.sh
```

Then inspect:
```bash
ls -la /tmp/test-microservices-debug-*.json
jq . /tmp/test-microservices-debug-<test>-<timestamp>.json
```
