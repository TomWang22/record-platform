# New Databases Setup Summary

## ✅ Completed Setup

All 3 new PostgreSQL databases have been created and are running:

### 1. Auction Monitor Database (Port 5438) - **REQUIRED**
- **Database**: `auction_monitor`
- **Schema**: `auction_monitor`
- **Purpose**: Stores historical auction results from discogs, popsike, gripseeat, ebay
- **Status**: ✅ Running and healthy
- **Connection**: `postgresql://postgres:postgres@localhost:5438/auction_monitor`

**Tables Created**:
- `auction_monitor.auction_results` - Historical auction data
- `auction_monitor.user_saved_auctions` - User-saved auctions for reference
- `auction_monitor.monitoring_jobs` - Active monitoring job tracking

**Function Created**:
- `auction_monitor.upsert_auction_result()` - Upsert function for auction results

### 2. Analytics Database (Port 5439) - **OPTIONAL**
- **Database**: `analytics`
- **Schema**: `analytics`
- **Purpose**: Analytics data, trends, snapshots, aggregated metrics
- **Status**: ✅ Running and healthy
- **Connection**: `postgresql://postgres:postgres@localhost:5439/analytics`
- **Note**: Analytics service can work with Redis/Kafka only. This database adds persistence.

**Tables Created**:
- `analytics.price_snapshots` - Historical price data
- `analytics.search_analytics` - Search patterns and trends
- `analytics.trend_snapshots` - Aggregated trend data
- `analytics.user_behavior` - User behavior event tracking
- `analytics.aggregated_metrics` - Pre-computed aggregations

### 3. Python AI Database (Port 5440) - **OPTIONAL**
- **Database**: `python_ai`
- **Schema**: `ai`
- **Purpose**: AI model data, predictions, training data, embeddings
- **Status**: ✅ Running and healthy
- **Connection**: `postgresql://postgres:postgres@localhost:5440/python_ai`
- **Note**: Python AI service can work with Redis only for caching. This database adds model persistence.

**Tables Created**:
- `ai.model_metadata` - AI model versions and metadata
- `ai.price_predictions` - Price predictions
- `ai.training_data` - Training data
- `ai.training_runs` - Training session tracking
- `ai.record_embeddings` - Vector embeddings (requires pgvector extension)
- `ai.prediction_feedback` - User feedback on predictions

## Environment Variables Updated

### Docker Compose (`docker-compose.yml`)
- ✅ `auction-monitor` service: `POSTGRES_URL` → `postgres-auction-monitor:5432/auction_monitor`
- ✅ `analytics-service`: `DATABASE_URL` and `POSTGRES_URL_ANALYTICS` → `postgres-analytics:5432/analytics`
- ✅ `python-ai-service`: `POSTGRES_URL_PYTHON_AI` → `postgres-python-ai:5432/python_ai`

### Kubernetes Config (`infra/k8s/base/config/app-config.yaml`)
- ✅ `POSTGRES_URL_AUCTION_MONITOR` → `host.docker.internal:5438/auction_monitor`
- ✅ `POSTGRES_URL_ANALYTICS` → `host.docker.internal:5439/analytics`
- ✅ `POSTGRES_URL_PYTHON_AI` → `host.docker.internal:5440/python_ai`

## Complete Database Port Mapping

| Port | Service | Database | Schema | Status |
|------|---------|----------|--------|--------|
| 5433 | Main DB | records | records | ✅ Running |
| 5434 | Social | records | forum, messages | ✅ Running |
| 5435 | Listings | records | listings | ✅ Running |
| 5436 | Shopping | records | shopping | ✅ Running |
| 5437 | Auth | records | auth | ✅ Running |
| 5438 | Auction Monitor | auction_monitor | auction_monitor | ✅ **NEW** |
| 5439 | Analytics | analytics | analytics | ✅ **NEW** |
| 5440 | Python AI | python_ai | ai | ✅ **NEW** |

## Next Steps: Service Code Updates

### 1. Auction Monitor Service
**Current State**: Uses `listings.upsert_auction()` and reads from `listings.watchlist`

**Needs Update**:
- Keep reading `listings.watchlist` from listings DB (port 5435) - this is correct
- Update to write auction results to `auction_monitor.auction_results` using `auction_monitor.upsert_auction_result()`
- Service already has `POSTGRES_URL` pointing to auction-monitor DB

**Code Change** (in `services/auction-monitor/src/worker.ts`):
```typescript
// OLD:
await pool.query(
  "SELECT listings.upsert_auction($1,$2,$3,$4,$5,$6,$7,$8)",
  [a.source, a.item_id, a.title, a.price, a.currency, a.shipping, a.ends_at, a.url]
);

// NEW:
await pool.query(
  "SELECT auction_monitor.upsert_auction_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
  [
    a.source,        // p_source
    a.item_id,       // p_external_id
    a.title,         // p_title
    a.price,         // p_price
    a.total,         // p_total_cost
    a.ends_at,       // p_sold_at
    null,            // p_artist (optional)
    null,            // p_label (optional)
    null,            // p_catalog_number (optional)
    null,            // p_format (optional)
    null,            // p_condition_record (optional)
    null,            // p_condition_sleeve (optional)
    a.currency,      // p_currency
    a.shipping,      // p_shipping_cost
    a.url,           // p_auction_url
    null,            // p_image_url (optional)
    null             // p_notes (optional)
  ]
);
```

**Note**: Auction monitor needs to connect to BOTH databases:
- Listings DB (port 5435) for reading watchlist
- Auction Monitor DB (port 5438) for writing results

### 2. Analytics Service
**Current State**: Uses `DATABASE_URL` and queries both `listings.search_history` and `analytics.price_snapshots`

**Options**:
1. **Keep current setup**: Analytics service connects to listings DB for search_history, analytics DB for price_snapshots (requires dual-DB connection)
2. **Migrate search_history**: Move search_history to analytics DB (requires data migration)
3. **Use analytics DB only**: Update code to use analytics.search_analytics instead of listings.search_history

**Recommended**: Option 1 (dual-DB) for now, migrate later if needed.

### 3. Python AI Service
**Current State**: No PostgreSQL code yet, only uses Redis

**Ready for**: When you add AI model persistence, predictions storage, or embeddings, the database is ready.

## Verification Commands

```bash
# Check all databases are running
docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Test connections
psql -h localhost -p 5438 -U postgres -d auction_monitor -c "SELECT current_database();"
psql -h localhost -p 5439 -U postgres -d analytics -c "SELECT current_database();"
psql -h localhost -p 5440 -U postgres -d python_ai -c "SELECT current_database();"

# Check schemas
psql -h localhost -p 5438 -U postgres -d auction_monitor -c "\dt auction_monitor.*"
psql -h localhost -p 5439 -U postgres -d analytics -c "\dt analytics.*"
psql -h localhost -p 5440 -U postgres -d python_ai -c "\dt ai.*"
```

## Setup Scripts

- `./scripts/setup-auction-monitor-db.sh` - Sets up auction-monitor database
- `./scripts/setup-analytics-db.sh` - Sets up analytics database
- `./scripts/setup-python-ai-db.sh` - Sets up python-ai database

All scripts are executable and can be re-run safely (they use `CREATE IF NOT EXISTS`).

