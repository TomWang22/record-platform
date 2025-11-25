import express from 'express';
import { Pool } from 'pg';
import { register, httpCounter } from '@common/utils';

// Dual-DB setup: listings DB for reading watchlist, auction-monitor DB for writing results
const POSTGRES_URL_LISTINGS = process.env.POSTGRES_URL_LISTINGS || process.env.POSTGRES_URL!;
const POSTGRES_URL_AUCTION_MONITOR = process.env.POSTGRES_URL_AUCTION_MONITOR || process.env.POSTGRES_URL!;

// Pool for reading watchlist from listings DB
const listingsPool = new Pool({ connectionString: POSTGRES_URL_LISTINGS });
// Pool for writing auction results to auction-monitor DB
const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR });

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
  try {
    // Check both databases
    await listingsPool.query('SELECT 1');
    await auctionPool.query('SELECT 1');
    res.json({ ok: true, db: 'connected', listings: 'ok', auction_monitor: 'ok' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'disconnected', error: String(err) });
  }
});

// Get active auctions being monitored (from watchlist)
app.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string | undefined;
    
    let query = `
      SELECT 
        w.id,
        w.user_id,
        w.source,
        w.query,
        w.created_at,
        COUNT(ar.id) as result_count,
        MAX(ar.sold_at) as last_updated
      FROM listings.watchlist w
      LEFT JOIN auction_monitor.auction_results ar ON ar.external_id = w.query
    `;
    
    const params: any[] = [];
    if (userId) {
      query += ' WHERE w.user_id = $1';
      params.push(userId);
    }
    
    query += ' GROUP BY w.id, w.user_id, w.source, w.query, w.created_at ORDER BY w.created_at DESC';
    
    const { rows } = await listingsPool.query(query, params);
    res.json(rows);
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
    const { rows } = await listingsPool.query(
      `INSERT INTO listings.watchlist (user_id, source, query)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, source, query) DO NOTHING
       RETURNING id, user_id, source, query, created_at`,
      [userId, source, query]
    );
    
    if (rows.length === 0) {
      // Already exists
      const existing = await listingsPool.query(
        'SELECT id, user_id, source, query, created_at FROM listings.watchlist WHERE user_id = $1 AND source = $2 AND query = $3',
        [userId, source, query]
      );
      return res.json({ message: 'Already monitoring', watchlist: existing.rows[0] });
    }
    
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
        ar.created_at,
        w.user_id
      FROM auction_monitor.auction_results ar
      LEFT JOIN listings.watchlist w ON w.query = ar.external_id OR ar.title ILIKE '%' || w.query || '%'
    `;
    
    const params: any[] = [];
    if (userId) {
      query += ' WHERE w.user_id = $1';
      params.push(userId);
    }
    
    query += ' ORDER BY ar.sold_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
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

