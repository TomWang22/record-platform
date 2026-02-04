# Smoke Test Fixes Summary

## Date: 2026-01-18

## Issues Found and Fixed

### 1. Database Schema Issues (FIXED ✅)

#### Records Service
- ✅ Added `insert_grade` column to `records.records` table
- ✅ Added `booklet_grade` column to `records.records` table
- ✅ Added `obi_strip_grade` column to `records.records` table
- ✅ Added `factory_sleeve_grade` column to `records.records` table
- ✅ Added `release_year` column to `records.records` table
- ✅ Added `release_date` column to `records.records` table
- ✅ Added `pressing_year` column to `records.records` table
- ✅ Added `label` column to `records.records` table
- ✅ Added `label_code` column to `records.records` table
- ✅ Added normalization columns (`artist_norm`, `name_norm`, `label_norm`, `catalog_norm`, `search_norm`)

#### Listings Service
- ✅ Added `media_type` column to `listings.listings` table
- ✅ Added `has_obi` column to `listings.listings` table
- ✅ Added `label_type` column to `listings.listings` table
- ✅ Added `stock_quantity` column to `listings.listings` table
- ✅ Added `duration_days` column to `listings.listings` table
- ✅ Added `visible_from` column to `listings.listings` table

#### Shopping Service
- ✅ Added `resellable` column to `shopping.purchase_history` table

### 2. Service Status

#### Working Services ✅
- Auth Service (Registration, Login, Logout, Delete Account)
- Social Service (Forum Posts, Comments, Messages, Groups)
- Listings Service (Health Check, Get My Listings, Search)
- Shopping Service (Get Orders, Get Purchase History, Get Resellable Purchases, Add Search History)
- All gRPC Health Checks (except Records SearchRecords)
- API Gateway
- Caddy (HTTP/2 and HTTP/3 health checks)

#### Partially Working ⚠️
- Records Service:
  - ✅ Health Check works
  - ⚠️ Create Record still failing (HTTP 500) - needs investigation
  - ⚠️ SearchRecords gRPC still failing - needs investigation

- Shopping Service:
  - ⚠️ Add to Cart failing (HTTP 500) - needs investigation
  - ⚠️ Get Cart failing (HTTP 500) - needs investigation

- Listings Service:
  - ⚠️ Search Listings returning HTTP 500 - needs investigation
  - ⚠️ Create Listing may still have issues

### 3. Known Issues (Pending Investigation)

1. **Records Service - Create Record**
   - Error: HTTP 500
   - Status: Needs logs investigation
   - Likely cause: Missing column or Prisma schema mismatch

2. **Shopping Service - Cart Operations**
   - Error: HTTP 500 on Add to Cart and Get Cart
   - Status: Needs investigation
   - Likely cause: Missing column in cart query or database schema issue

3. **Listings Service - Search Listings**
   - Error: HTTP 500 (Internal server error)
   - Status: Needs investigation
   - Likely cause: Database query issue

4. **gRPC Routing via Envoy**
   - Some gRPC methods still failing via Envoy NodePort
   - Direct port-forward works
   - Status: Needs Envoy configuration investigation

### 4. Commands Used to Fix Schema

```bash
# Records Service
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c "ALTER TABLE records.records ADD COLUMN IF NOT EXISTS insert_grade VARCHAR(16);"
# ... (and other columns)

# Listings Service
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d records -c "ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS media_type VARCHAR(128);"
# ... (and other columns)

# Shopping Service
PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d records -c "ALTER TABLE shopping.purchase_history ADD COLUMN IF NOT EXISTS resellable BOOLEAN DEFAULT true;"
```

### 5. Next Steps

1. Investigate Records Service Create Record error (check logs for specific missing column)
2. Investigate Shopping Service Cart errors (check cart query for missing columns)
3. Investigate Listings Service Search error (check database query)
4. Review Prisma schemas vs actual database schemas for all services
5. Consider running Prisma migrations to sync schema

### 6. Test Results Summary

- **Total Tests**: ~40+ tests
- **Passing**: ~30 tests ✅
- **Failing**: ~6 tests ⚠️
- **Success Rate**: ~75%

Most critical database schema issues have been resolved. Remaining issues are specific to certain endpoints and require detailed log investigation.
