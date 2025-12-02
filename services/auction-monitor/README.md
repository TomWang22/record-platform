# Auction Monitor Service

Multi-platform auction monitoring service with comprehensive data pipeline architecture.

## Overview

The Auction Monitor service ingests auction listings from multiple platforms (eBay, Discogs, Buyee, YahooJP, CarousellHK, RecordCity), normalizes the data, validates quality, and stores it in a unified schema for analytics and AI processing.

## Architecture

See [AUCTION_MONITOR_DATA_PIPELINE.md](../../AUCTION_MONITOR_DATA_PIPELINE.md) for comprehensive architecture documentation.

### Data Flow

```
Platform APIs/Scrapers → Platform Adapters → Normalizer → Validator → Staging Pipeline → PostgreSQL
```

### Components

1. **Platform Adapters** (`src/platforms/`)
   - `eBayAdapter`: eBay Finding API and Browse API
   - `DiscogsAdapter`: Discogs Database API and Marketplace API
   - Base adapter interface for easy extension

2. **Data Normalizer** (`src/normalizers/`)
   - Converts platform-specific data to unified schema
   - Normalizes currencies, conditions, formats, URLs

3. **Validation Engine** (`src/validators/`)
   - Validates required fields, data types, business rules
   - Calculates completeness scores

4. **Staging Pipeline** (`src/pipeline/`)
   - Processes raw listings: raw → normalized → validated
   - Handles deduplication, confidence scoring
   - Stores in PostgreSQL staging tables

## Database Schema

The service uses the `auction_monitor` schema with the following tables:

- `raw_listings`: Staging table for raw platform data
- `normalized_listings`: Unified schema, validated data
- `price_history`: Time-series price snapshots
- `user_watches`: User-defined search criteria
- `watch_matches`: Listings matching user watches
- `platform_health`: Platform availability monitoring
- `data_quality_metrics`: Quality tracking per platform

See `infra/db/07-auction-monitor-schema-extended.sql` for full schema definition.

## Usage

### Basic Example

```typescript
import { Pool } from 'pg'
import { eBayAdapter } from './platforms'
import { StagingPipeline } from './pipeline/staging-pipeline'

const pool = new Pool({ connectionString: process.env.POSTGRES_URL_AUCTION_MONITOR })
const ebayAdapter = new eBayAdapter({
  appId: process.env.EBAY_APP_ID!,
  authToken: process.env.EBAY_AUTH_TOKEN,
})
const pipeline = new StagingPipeline(pool)

// Search for listings
const listings = await ebayAdapter.search({
  query: 'The Beatles Abbey Road',
  limit: 10,
})

// Process through pipeline
for (const listing of listings) {
  const result = await pipeline.processRawListing(listing)
  console.log(result.success ? '✅' : '❌', listing.title)
}
```

### Environment Variables

```bash
# Database
POSTGRES_URL_AUCTION_MONITOR=postgresql://user:pass@host:5432/db

# eBay API
EBAY_APP_ID=your_app_id
EBAY_AUTH_TOKEN=your_auth_token
EBAY_SANDBOX=true  # Use sandbox environment

# Discogs API
DISCOGS_USER_TOKEN=your_user_token
```

## Platform Support

### ✅ Implemented

- **eBay**: Official API (Finding API, Browse API)
- **Discogs**: Official API (Database API, Marketplace API)

### 🚧 Planned (Phase 2)

- **Buyee**: Web scraping (Puppeteer)
- **YahooJP**: Web scraping (Puppeteer)
- **CarousellHK**: Web scraping (Puppeteer)
- **RecordCity**: Web scraping (Puppeteer, multi-region)

## Data Quality

The pipeline implements comprehensive data quality controls:

- **Confidence Scoring**: 0.0-1.0 based on completeness, source reliability, freshness
- **Completeness Scoring**: Percentage of required/important fields populated
- **Validation**: Required fields, data types, business rules
- **Deduplication**: Exact match, URL match, fuzzy matching

Only high-confidence data (≥0.7) is stored in `normalized_listings` and fed to Analytics Service.

## Development

### Build

```bash
pnpm build
```

### Run

```bash
pnpm start
```

### Development Mode

```bash
pnpm dev
```

## API Endpoints

The service exposes HTTP endpoints (see `src/server.ts`):

- `GET /healthz`: Health check
- `GET /metrics`: Prometheus metrics
- `GET /`: List active watches
- `GET /results/:watchlistId`: Get results for a watch
- `POST /monitor`: Start monitoring a query

## Next Steps

1. **Phase 2**: Add scraping platforms (Buyee, YahooJP, etc.)
2. **Phase 3**: Integrate with Analytics Service for price analysis
3. **Phase 4**: Add data enrichment (Discogs catalog matching)
4. **Phase 5**: Implement user watch matching and notifications

## Related Documentation

- [AUCTION_MONITOR_ARCHITECTURE.md](../../AUCTION_MONITOR_ARCHITECTURE.md): Overall architecture and design
- [AUCTION_MONITOR_DATA_PIPELINE.md](../../AUCTION_MONITOR_DATA_PIPELINE.md): Detailed data pipeline implementation

