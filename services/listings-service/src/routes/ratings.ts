import { Router } from 'express';
import { verifyJwt } from '@common/utils/auth';
import { pool } from '../lib/db.js';

const router: Router = Router();

// Auth middleware
router.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'auth required' });
  }
  try {
    (req as any).user = verifyJwt(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
});

// POST /ratings - Create or update rating
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const { listing_id, rating, review_text, transaction_id } = req.body;

    if (!listing_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'listing_id and rating (1-5) required' });
    }

    // Get seller_id from listing
    const listingResult = await pool.query(
      'SELECT user_id FROM listings.listings WHERE id = $1',
      [listing_id]
    );

    if (listingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const sellerId = listingResult.rows[0].user_id;

    // Upsert rating
    const result = await pool.query(
      `INSERT INTO listings.ratings (listing_id, user_id, seller_id, rating, review_text, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (listing_id, user_id) 
       DO UPDATE SET rating = EXCLUDED.rating, review_text = EXCLUDED.review_text, updated_at = now()
       RETURNING *`,
      [listing_id, userId, sellerId, rating, review_text || null, transaction_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[listings] create rating error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /ratings/listing/:id - Get ratings for a listing
router.get('/listing/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, 
              (SELECT email FROM auth.users WHERE id = r.user_id) as reviewer_email
       FROM listings.ratings r
       WHERE r.listing_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );

    res.json({ ratings: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[listings] get ratings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /ratings/seller/:id - Get ratings for a seller
router.get('/seller/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, l.title as listing_title,
              (SELECT email FROM auth.users WHERE id = r.user_id) as reviewer_email
       FROM listings.ratings r
       JOIN listings.listings l ON r.listing_id = l.id
       WHERE r.seller_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );

    const avgRating = await pool.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM listings.ratings WHERE seller_id = $1',
      [req.params.id]
    );

    res.json({
      ratings: result.rows,
      count: result.rows.length,
      average_rating: parseFloat(avgRating.rows[0]?.avg_rating || '0'),
      total_ratings: parseInt(avgRating.rows[0]?.count || '0'),
    });
  } catch (err) {
    console.error('[listings] get seller ratings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

