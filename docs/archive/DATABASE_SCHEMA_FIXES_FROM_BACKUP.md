# Database Schema Fixes Based on Backup SQL Files

## Date: 2026-01-18

## Schema Reference
Using backup SQL files from `backups/` directory dated 2026-01-01 for schema definitions.

## Additional Fixes Applied

### 1. Listings Service - Missing Columns ✅

Based on `backups/record-platform-postgres-listings-1-all-20260101-223214.sql`:

```sql
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS popularity_score INTEGER DEFAULT 0;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS seller_rating NUMERIC(3,2);
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS seller_rating_count INTEGER DEFAULT 0;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS visible_until TIMESTAMP WITH TIME ZONE;
```

### 2. Shopping Service - Cart Table ✅

Based on `backups/record-platform-postgres-shopping-1-all-20260101-223214.sql`:

The shopping_cart table should have a `notes` column:
```sql
ALTER TABLE shopping.shopping_cart ADD COLUMN IF NOT EXISTS notes TEXT;
```

### 3. Foreign Key Constraint Analysis

#### Records Service Foreign Key Issue

The error `Foreign key constraint violated on the constraint: records_user_id_fkey` indicates:

- **Constraint exists**: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- **Problem**: The `user_id` being used in CreateRecord doesn't exist in `auth.users` table
- **Root cause**: This is a **data issue**, not a schema issue
  - The user must exist in `auth.users` before creating a record
  - The smoke test creates users via auth-service registration, which should create the user
  - Possible causes:
    1. User registration failed silently
    2. User created in wrong database (main DB vs auth DB)
    3. Database connection mismatch (auth-service uses port 5437, records-service might need same user)

### 4. Complete Schema Checklist from Backup Files

#### Records Table (records.records)
✅ All columns verified from backup:
- `insert_grade`, `booklet_grade`, `obi_strip_grade`, `factory_sleeve_grade`
- `release_year`, `release_date`, `pressing_year`
- `label`, `label_code`
- `artist_norm`, `name_norm`, `label_norm`, `catalog_norm`, `search_norm`

#### Listings Table (listings.listings)
✅ All columns from backup now present:
- `media_type`, `has_obi`, `label_type`
- `stock_quantity`, `duration_days`, `visible_from`, `visible_until`
- `popularity_score`, `seller_rating`, `seller_rating_count`, `catalog_id`

#### Shopping Tables
✅ `purchase_history.resellable` - Present
✅ `shopping_cart.notes` - Added

### 5. Remaining Issues

#### Records Service Create Record
- **Error**: `Foreign key constraint violated: records_user_id_fkey`
- **Status**: Data/constraint issue, not schema
- **Fix needed**: Ensure user exists in `auth.users` before creating record
- **Investigation**: Check if auth-service registration creates user in correct database

#### Shopping Service Cart Operations
- **Error**: HTTP 500 on Add to Cart / Get Cart
- **Status**: Needs investigation of cart query
- **Possible cause**: Missing column in query or database connection issue

### 6. Verification Commands

```bash
# Check records table columns
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c "\d records.records"

# Check listings table columns
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d records -c "\d listings.listings"

# Check shopping_cart columns
PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d records -c "\d shopping.shopping_cart"

# Check foreign key constraints
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c "SELECT conname, confrelid::regclass, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'records.records'::regclass AND contype = 'f';"

# Verify user exists in auth.users
PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -c "SELECT id, email FROM auth.users LIMIT 5;"
```

### 7. Next Steps

1. ✅ **Schema fixes complete** - All columns from backup SQL files are now present
2. 🔍 **Investigate user creation** - Verify auth-service creates users correctly
3. 🔍 **Investigate cart queries** - Check shopping-service cart query for missing columns
4. 🔍 **Test user flow** - Ensure user registration → record creation flow works end-to-end
