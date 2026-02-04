# Service-Specific Database Tuning Summary

## Overview

Each database gets tuning optimized for its workload pattern and function. This ensures optimal performance for each service's specific use case.

## Database Workload Patterns

### 1. Records Service (Port 5433) - Read/Write Heavy, Fuzzy Search, 2.4M+ Records

**Workload**: Read/write heavy (collectors constantly adding/updating records), fuzzy text search, large dataset (2.4M+ records)

**Tuning**:
- ✅ **Comprehensive tuning** (`comprehensive-db-tuning.sql`)
- ✅ **Partial indexes**: Hot tenant, recent records, active records
- ✅ **Composite indexes**: User+Artist+Name, User+Catalog+Format, User+Year+Label
- ✅ **Trigram indexes**: GIN/GiST for fuzzy search (artist, name, catalog, search_norm)
- ✅ **Covering indexes**: Index-only scans with INCLUDE columns
- ✅ **Worker threads**: 4 parallel workers, 12 total processes
- ✅ **Memory**: 16MB work_mem, 1GB maintenance_work_mem, 2GB shared_buffers
- ✅ **Disable sequential scans**: `enable_seqscan = off` (force index usage)
- ✅ **Autovacuum**: Balanced (scale_factor 0.05/0.05) for read/write heavy workload (collectors add/update frequently)

**Target**: 5.1k TPS with 2.4M+ records, 256 pgbench clients

### 2. Social Service (Port 5434) - Write-Heavy, Messaging

**Workload**: Heavy write operations (messages, forum posts), frequent INSERTs

**Tuning**:
- ✅ **Composite indexes**: User+created_at DESC (message lookups)
- ✅ **Recipient indexes**: Recipient_id+created_at for inbox
- ✅ **Group indexes**: Group_id+created_at for group messages
- ✅ **Forum post indexes**: Created_at DESC, user_id+created_at
- ✅ **Partial indexes**: Active messages (last 90 days)
- ✅ **Autovacuum**: Write-heavy (scale_factor 0.1/0.05)

**Optimization**: Focus on write performance, frequent message queries

### 3. Listings Service (Port 5435) - Write-Heavy, Auctions

**Workload**: Heavy write operations (listings, bids, auctions), search queries

**Tuning**:
- ✅ **Trigram indexes**: GIN for search_history.q (fuzzy search)
- ✅ **Partial indexes**: Active listings, active category
- ✅ **Composite indexes**: User+type+category+price, active+type+price
- ✅ **Autovacuum**: Write-heavy (scale_factor 0.1/0.05)
- ✅ **Statistics**: Regular ANALYZE on listings, auction_details

**Optimization**: Balance write performance with search queries

### 4. Shopping Service (Port 5436) - Write-Heavy, Carts/Orders

**Workload**: Heavy write operations (cart, orders, purchase history), frequent updates

**Tuning**:
- ✅ **Composite indexes**: User+item_type+item_id (cart lookups)
- ✅ **User+updated_at**: For cart queries (most recent)
- ✅ **Partial indexes**: Active carts (last 30 days)
- ✅ **Orders indexes**: User+status+created_at, user+payment_status
- ✅ **Purchase history**: User+resellable (partial), user+purchased_at
- ✅ **Autovacuum**: Write-heavy (scale_factor 0.1/0.05) on all tables

**Optimization**: Fast cart/order operations, eBay-style resell queries

### 5. Auth Service (Port 5437) - Read-Heavy, User Lookups

**Workload**: Read-heavy (user lookups by email, token validation), infrequent writes

**Tuning**:
- ✅ **User lookup indexes**: Email index (most common query)
- ✅ **OAuth token indexes**: User_id+expires_at, token lookup
- ✅ **Partial indexes**: Active tokens (expires_at > NOW())
- ✅ **JWT revocation**: Token index (fast lookups)
- ✅ **Autovacuum**: Read-heavy, less aggressive (scale_factor 0.2/0.1)

**Optimization**: Fast user/email lookups, token validation

### 6. Analytics Service (Port 5438) - Read-Heavy, Aggregations

**Workload**: Read-heavy (aggregations, time-series queries), append-only writes

**Tuning**:
- ✅ **Time-series indexes**: Timestamp DESC+item_id (price snapshots)
- ✅ **User behavior**: User_id+timestamp DESC
- ✅ **Partial indexes**: Recent data (last 90 days)
- ✅ **GIN index**: Metadata JSON queries (user_behavior.metadata)
- ✅ **Autovacuum**: Read-heavy, append-only (scale_factor 0.2/0.1)

**Optimization**: Fast aggregations, time-series queries

### 7. Auction Monitor Service (Port 5439) - Read-Heavy, Price Tracking

**Workload**: Read-heavy (price tracking, auction results), append-only writes

**Tuning**:
- ✅ **Auction results indexes**: Item_id+sold_at DESC, sold_at+price
- ✅ **Watchlist indexes**: User_id+source+query (linked to listings)
- ✅ **Partial indexes**: Recent auctions (last 90 days)
- ✅ **Full-text search**: GIN tsvector on title+artist+label
- ✅ **Autovacuum**: Read-heavy (scale_factor 0.2/0.1)

**Optimization**: Fast price tracking, auction result queries

### 8. Python AI Service (Port 5440) - Read/Write Mix, AI Data

**Workload**: Balanced read/write (inference logs, analytics cache)

**Tuning**:
- ✅ **Inference log indexes**: Timestamp DESC+user_id, user_id+timestamp
- ✅ **Analytics cache**: Cache_key index (read-heavy), updated_at DESC
- ✅ **Partial indexes**: Recent inferences (last 30 days)
- ✅ **Autovacuum**: Balanced (scale_factor 0.1/0.05 for logs, 0.2/0.1 for cache)

**Optimization**: Balanced performance for AI model data and inference logs

## Tuning Files

1. **`infra/db/comprehensive-db-tuning.sql`** - Records service (most comprehensive)
2. **`infra/db/service-specific-tuning.sql`** - Other services (social, auth, analytics, etc.)
3. **`scripts/restore-and-tune-all-databases.sh`** - Master script (applies both)

## Execution Order

1. **Restore SQL backups** (step-by-step)
2. **Apply comprehensive tuning** (records service - full optimization)
3. **Apply service-specific tuning** (other services - workload-optimized)
4. **Verify tuning** (check indexes, extensions, settings)

## Expected Performance

- **Records**: 5.1k TPS with 2.4M+ records (comprehensive tuning)
- **Social/Listings/Shopping**: Optimized for write-heavy workloads
- **Auth/Analytics/Auction Monitor**: Optimized for read-heavy workloads
- **Python AI**: Balanced for mixed read/write patterns

## Notes

- Each database gets **appropriate** tuning for its workload
- **Read-heavy** services: Less aggressive autovacuum, focus on index scans
- **Write-heavy** services: Aggressive autovacuum, focus on write performance
- **Records service**: Most comprehensive (all tuning techniques)
- **Other services**: Focused tuning (workload-specific optimizations)
