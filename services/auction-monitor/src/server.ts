import express from 'express';
import { Pool } from 'pg';
import { register, httpCounter } from '@common/utils';

// Dual-DB setup: listings DB for reading watchlist, auction-monitor DB for writing results
const POSTGRES_URL_LISTINGS = process.env.POSTGRES_URL_LISTINGS || process.env.POSTGRES_URL!;
const POSTGRES_URL_AUCTION_MONITOR = process.env.POSTGRES_URL_AUCTION_MONITOR || process.env.POSTGRES_URL!;

// Connection pools for auction-monitor service
// Low concurrency: Background worker service
// Standard pool size: 50 connections per pool (reading watchlist, writing results)
const listingsPool = new Pool({
  connectionString: POSTGRES_URL_LISTINGS,
  max: parseInt(process.env.DB_POOL_MAX || '50', 10), // Low concurrency: background worker
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  idleTimeoutMillis: 60000, // 1 minute
  connectionTimeoutMillis: 10000, // 10 seconds
  statement_timeout: 30000, // 30 second statement timeout
  query_timeout: 30000, // 30 second query timeout
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

const auctionPool = new Pool({
  connectionString: POSTGRES_URL_AUCTION_MONITOR,
  max: parseInt(process.env.DB_POOL_MAX || '50', 10), // Low concurrency: background worker
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  idleTimeoutMillis: 60000, // 1 minute
  connectionTimeoutMillis: 10000, // 10 seconds
  statement_timeout: 30000, // 30 second statement timeout
  query_timeout: 30000, // 30 second query timeout
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Error handling for connection pools
listingsPool.on('error', (err) => {
  console.error('[auction-monitor] Listings DB pool error:', err);
});

auctionPool.on('error', (err) => {
  console.error('[auction-monitor] Auction DB pool error:', err);
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () =>
    httpCounter.inc({ service: 'auction-monitor', route: req.path, method: req.method, code: res.statusCode })
  );
  next();
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/healthz', async (_req, res) => {
  const status = {
    ok: true,
    listings: 'unknown',
    auction_monitor: 'unknown',
    timestamp: new Date().toISOString()
  };
  
  // Check listings DB (REQUIRED - service needs this to read watchlist)
  try {
    await listingsPool.query('SELECT 1');
    status.listings = 'ok';
  } catch (err) {
    status.listings = 'error';
    status.ok = false;
    console.error('[auction-monitor] listings DB check failed:', err);
  }
  
  // Check auction-monitor DB (REQUIRED - service needs this to write results)
  try {
    await auctionPool.query('SELECT 1');
    status.auction_monitor = 'ok';
  } catch (err) {
    status.auction_monitor = 'error';
    status.ok = false;
    console.error('[auction-monitor] auction-monitor DB check failed:', err);
  }
  
  // BOTH databases are REQUIRED - return 503 if either fails
  // Service cannot function properly without both databases
  const httpStatus = status.ok ? 200 : 503;
  res.status(httpStatus).json(status);
});

// Get active auctions being monitored (from watchlist)
app.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string | undefined;
    
    // Query watchlist from listings DB
    let watchlistQuery = 'SELECT id, user_id, source, query, created_at FROM listings.watchlist';
    const params: any[] = [];
    if (userId) {
      watchlistQuery += ' WHERE user_id = $1';
      params.push(userId);
    }
    watchlistQuery += ' ORDER BY created_at DESC';
    
    const { rows: watchlistRows } = await listingsPool.query(watchlistQuery, params);
    
    // For each watchlist item, get result count from auction-monitor DB
    // Use Promise.all to query in parallel
    const enrichedRows = await Promise.all(
      watchlistRows.map(async (w: any) => {
        // Query auction results for this watchlist query
        const resultQuery = await auctionPool.query(
          `SELECT COUNT(*) as count, MAX(sold_at) as last_updated
           FROM auction_monitor.auction_results
           WHERE external_id = $1 OR title ILIKE $2`,
          [w.query, `%${w.query}%`]
        );
        
        return {
          ...w,
          result_count: parseInt(resultQuery.rows[0]?.count || '0', 10),
          last_updated: resultQuery.rows[0]?.last_updated || null
        };
      })
    );
    
    res.json(enrichedRows);
  } catch (err) {
    console.error('[auction-monitor] GET / error:', err);
    res.status(500).json({ error: 'Internal server error', details: String(err) });
  }
});

// Get auction results for a specific watchlist item
app.get('/results/:watchlistId', async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const userId = req.headers['x-user-id'] as string | undefined;
    
    // First verify the watchlist item belongs to the user
    const watchlistCheck = await listingsPool.query(
      'SELECT user_id FROM listings.watchlist WHERE id = $1',
      [watchlistId]
    );
    
    if (watchlistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }
    
    if (userId && watchlistCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Get the query from watchlist
    const watchlistItem = watchlistCheck.rows[0];
    
    // Get auction results matching this query
    const { rows } = await auctionPool.query(
      `SELECT 
        id,
        source,
        external_id,
        title,
        price,
        total_cost,
        currency,
        shipping_cost,
        sold_at,
        auction_url,
        image_url,
        created_at
      FROM auction_monitor.auction_results
      WHERE external_id = $1 OR title ILIKE $2
      ORDER BY sold_at DESC
      LIMIT 100`,
      [watchlistItem.query || '', `%${watchlistItem.query || ''}%`]
    );
    
    res.json({ watchlistId, results: rows, count: rows.length });
  } catch (err) {
    console.error('[auction-monitor] GET /results/:watchlistId error:', err);
    res.status(500).json({ error: 'Internal server error', details: String(err) });
  }
});

// Start monitoring (adds to watchlist via listings service)
// This is a convenience endpoint - actual watchlist management is in listings service
app.post('/monitor', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string | undefined;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { query, source = 'ebay' } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    // Add to watchlist in listings DB
    // Check if already exists first (partial unique index doesn't work with ON CONFLICT)
    const existing = await listingsPool.query(
      'SELECT id, user_id, source, query, created_at FROM listings.watchlist WHERE user_id = $1 AND source = $2 AND query = $3',
      [userId, source, query]
    );
    
    if (existing.rows.length > 0) {
      return res.json({ message: 'Already monitoring', watchlist: existing.rows[0] });
    }
    
    const { rows } = await listingsPool.query(
      `INSERT INTO listings.watchlist (user_id, source, query)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, source, query, created_at`,
      [userId, source, query]
    );
    
    res.status(201).json({ message: 'Monitoring started', watchlist: rows[0] });
  } catch (err) {
    console.error('[auction-monitor] POST /monitor error:', err);
    res.status(500).json({ error: 'Internal server error', details: String(err) });
  }
});

// Get recent auction results (all users, or filtered by user)
app.get('/results', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    // Get auction results from auction_monitor database
    let query = `
      SELECT 
        ar.id,
        ar.source,
        ar.external_id,
        ar.title,
        ar.price,
        ar.total_cost,
        ar.currency,
        ar.shipping_cost,
        ar.sold_at,
        ar.auction_url,
        ar.image_url,
        ar.created_at
      FROM auction_monitor.auction_results ar
    `;
    
    const params: any[] = [];
    let paramCount = 0;
    
    // If userId provided, filter by matching watchlist entries
    if (userId) {
      // First get watchlist queries for this user
      const watchlistResult = await listingsPool.query(
        'SELECT query FROM listings.watchlist WHERE user_id = $1 AND query IS NOT NULL',
        [userId]
      );
      
      if (watchlistResult.rows.length === 0) {
        return res.json({ results: [], count: 0, limit, offset });
      }
      
      const queries = watchlistResult.rows.map((r: any) => r.query);
      const conditions = queries.map((q: string, i: number) => {
        paramCount++;
        params.push(`%${q}%`);
        return `ar.title ILIKE $${paramCount}`;
      }).join(' OR ');
      
      query += ` WHERE ${conditions}`;
    }
    
    query += ` ORDER BY ar.sold_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);
    
    const { rows } = await auctionPool.query(query, params);
    res.json({ results: rows, count: rows.length, limit, offset });
  } catch (err) {
    console.error('[auction-monitor] GET /results error:', err);
    res.status(500).json({ error: 'Internal server error', details: String(err) });
  }
});

// Use port 4008 for HTTP server (matches K8s service port)
const HTTP_PORT = 4008;
const server = app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[auction-monitor] HTTP server listening on port ${HTTP_PORT}`);
});

// Start gRPC server if enabled
let grpcServer: any = null;
if (process.env.ENABLE_GRPC === 'true') {
  const { startGrpcServer } = require('./grpc-server');
  const grpcPort = parseInt(process.env.GRPC_PORT || '50059', 10);
  grpcServer = startGrpcServer(grpcPort);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[auction-monitor] SIGTERM received, shutting down gracefully');
  server.close(() => {
    if (grpcServer) {
      grpcServer.tryShutdown(() => {
        Promise.all([listingsPool.end(), auctionPool.end()]).then(() => {
          console.log('[auction-monitor] DB pools closed');
          process.exit(0);
        });
      });
    } else {
      Promise.all([listingsPool.end(), auctionPool.end()]).then(() => {
        console.log('[auction-monitor] DB pools closed');
        process.exit(0);
      });
    }
  });
});

