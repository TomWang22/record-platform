// Direct PostgreSQL client for listings-service
// This bypasses Prisma if generation fails
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_LISTINGS || 'postgresql://postgres:postgres@localhost:5435/records',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('[listings-db] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[listings-db] Unexpected error on idle client', err);
});

export { pool };

// Helper functions for listings
export async function getListingsByUser(userId: string, limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM listings.listings 
     WHERE user_id = $1 AND is_active = true 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

export async function getListingById(listingId: string) {
  const result = await pool.query(
    `SELECT l.*, 
            json_agg(
              json_build_object(
                'id', li.id,
                'image_url', li.image_url,
                'thumbnail_url', li.thumbnail_url,
                'display_order', li.display_order,
                'is_primary', li.is_primary
              ) ORDER BY li.display_order
            ) FILTER (WHERE li.id IS NOT NULL) as images,
            CASE 
              WHEN l.listing_type = 'auction' THEN json_build_object(
                'starting_bid', ad.starting_bid,
                'current_bid', ad.current_bid,
                'current_bidder', ad.current_bidder,
                'reserve_price', ad.reserve_price,
                'end_time', ad.end_time,
                'bid_count', ad.bid_count
              )
              ELSE NULL
            END as auction_details
     FROM listings.listings l
     LEFT JOIN listings.listing_images li ON l.id = li.listing_id
     LEFT JOIN listings.auction_details ad ON l.id = ad.listing_id AND l.listing_type = 'auction'
     WHERE l.id = $1
     GROUP BY l.id, ad.id`,
    [listingId]
  );
  return result.rows[0] || null;
}

export async function createListing(data: {
  user_id: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  listing_type?: string;
  condition?: string;
  category?: string;
  location?: string;
  shipping_cost?: number;
  shipping_method?: string;
  expires_at?: Date;
}) {
  const result = await pool.query(
    `INSERT INTO listings.listings (
      user_id, title, description, price, currency, listing_type,
      condition, category, location, shipping_cost, shipping_method, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      data.user_id,
      data.title,
      data.description || null,
      data.price,
      data.currency || 'USD',
      data.listing_type || 'fixed_price',
      data.condition || null,
      data.category || null,
      data.location || null,
      data.shipping_cost || 0,
      data.shipping_method || null,
      data.expires_at || null,
    ]
  );

  const listing = result.rows[0];

  // If auction, create auction_details
  if (data.listing_type === 'auction' && data.expires_at) {
    await pool.query(
      `INSERT INTO listings.auction_details (
        listing_id, starting_bid, end_time
      ) VALUES ($1, $2, $3)`,
      [listing.id, data.price, data.expires_at]
    );
  }

  return listing;
}

export async function updateListing(listingId: string, userId: string, updates: Partial<{
  title: string;
  description: string;
  price: number;
  condition: string;
  category: string;
  location: string;
  shipping_cost: number;
  shipping_method: string;
  is_active: boolean;
}>) {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  });

  if (fields.length === 0) {
    return null;
  }

  values.push(listingId, userId);
  const result = await pool.query(
    `UPDATE listings.listings 
     SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

export async function deleteListing(listingId: string, userId: string) {
  const result = await pool.query(
    `UPDATE listings.listings 
     SET is_active = false, updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [listingId, userId]
  );
  return result.rowCount > 0;
}

export async function addListingImage(listingId: string, imageData: {
  image_url: string;
  image_path?: string;
  thumbnail_url?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
  display_order?: number;
  is_primary?: boolean;
}) {
  const result = await pool.query(
    `INSERT INTO listings.listing_images (
      listing_id, image_url, image_path, thumbnail_url, file_name,
      file_size, mime_type, width, height, display_order, is_primary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      listingId,
      imageData.image_url,
      imageData.image_path || null,
      imageData.thumbnail_url || null,
      imageData.file_name || null,
      imageData.file_size || null,
      imageData.mime_type || null,
      imageData.width || null,
      imageData.height || null,
      imageData.display_order || 0,
      imageData.is_primary || false,
    ]
  );
  return result.rows[0];
}

export async function placeBid(listingId: string, userId: string, bidAmount: number) {
  // Check if listing is auction and active
  const listing = await pool.query(
    `SELECT l.*, ad.end_time, ad.current_bid, ad.starting_bid
     FROM listings.listings l
     LEFT JOIN listings.auction_details ad ON l.id = ad.listing_id
     WHERE l.id = $1 AND l.listing_type = 'auction' AND l.is_active = true`,
    [listingId]
  );

  if (listing.rows.length === 0) {
    throw new Error('Listing not found or not an active auction');
  }

  const listingData = listing.rows[0];
  const minBid = listingData.current_bid || listingData.starting_bid;

  if (bidAmount <= minBid) {
    throw new Error(`Bid must be higher than current bid (${minBid})`);
  }

  if (listingData.end_time && new Date(listingData.end_time) < new Date()) {
    throw new Error('Auction has ended');
  }

  // Insert bid (trigger will handle updating auction_details)
  const result = await pool.query(
    `INSERT INTO listings.bids (listing_id, user_id, bid_amount, is_winning)
     VALUES ($1, $2, $3, true)
     RETURNING *`,
    [listingId, userId, bidAmount]
  );

  return result.rows[0];
}

export async function makeOffer(listingId: string, userId: string, offerAmount: number, message?: string) {
  const result = await pool.query(
    `INSERT INTO listings.offers (listing_id, user_id, offer_amount, message, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [listingId, userId, offerAmount, message || null]
  );
  return result.rows[0];
}

export async function addToWatchlist(userId: string, listingId: string) {
  const result = await pool.query(
    `INSERT INTO listings.watchlist (user_id, listing_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, listing_id) DO NOTHING
     RETURNING *`,
    [userId, listingId]
  );
  return result.rows[0] || null;
}

export async function removeFromWatchlist(userId: string, listingId: string) {
  const result = await pool.query(
    `DELETE FROM listings.watchlist
     WHERE user_id = $1 AND listing_id = $2`,
    [userId, listingId]
  );
  return result.rowCount > 0;
}

export async function getUserWatchlist(userId: string) {
  const result = await pool.query(
    `SELECT l.*, w.created_at as watched_at
     FROM listings.watchlist w
     JOIN listings.listings l ON w.listing_id = l.id
     WHERE w.user_id = $1 AND l.is_active = true
     ORDER BY w.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function searchListings(query: string, filters?: {
  listing_type?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  condition?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = ['l.is_active = true'];
  const params: any[] = [];
  let paramIndex = 1;

  if (query) {
    conditions.push(`(l.title ILIKE $${paramIndex} OR l.description ILIKE $${paramIndex})`);
    params.push(`%${query}%`);
    paramIndex++;
  }

  if (filters?.listing_type) {
    conditions.push(`l.listing_type = $${paramIndex}`);
    params.push(filters.listing_type);
    paramIndex++;
  }

  if (filters?.category) {
    conditions.push(`l.category = $${paramIndex}`);
    params.push(filters.category);
    paramIndex++;
  }

  if (filters?.min_price !== undefined) {
    conditions.push(`l.price >= $${paramIndex}`);
    params.push(filters.min_price);
    paramIndex++;
  }

  if (filters?.max_price !== undefined) {
    conditions.push(`l.price <= $${paramIndex}`);
    params.push(filters.max_price);
    paramIndex++;
  }

  if (filters?.condition) {
    conditions.push(`l.condition = $${paramIndex}`);
    params.push(filters.condition);
    paramIndex++;
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  const result = await pool.query(
    `SELECT l.*, 
            (SELECT json_agg(
              json_build_object(
                'id', li.id,
                'image_url', li.image_url,
                'thumbnail_url', li.thumbnail_url,
                'is_primary', li.is_primary
              ) ORDER BY li.display_order
            ) FROM listings.listing_images li WHERE li.listing_id = l.id LIMIT 1) as primary_image
     FROM listings.listings l
     WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return result.rows;
}

