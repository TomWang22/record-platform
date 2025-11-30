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
  media_type?: string;
  has_obi?: boolean;
  label_type?: string;
  stock_quantity?: number;
  duration_days?: number;
  visible_from?: Date;
  catalog_id?: string;
}) {
  const result = await pool.query(
    `INSERT INTO listings.listings (
      user_id, title, description, price, currency, listing_type,
      condition, category, location, shipping_cost, shipping_method, expires_at,
      media_type, has_obi, label_type, stock_quantity, duration_days, visible_from, catalog_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      data.media_type || null,
      data.has_obi || false,
      data.label_type || null,
      data.stock_quantity || 1,
      data.duration_days || 30,
      data.visible_from || new Date(),
      data.catalog_id || null,
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
  catalog_id: string;
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
  return (result.rowCount !== null && result.rowCount > 0);
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
  return (result.rowCount !== null && result.rowCount > 0);
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
  media_type?: string;
  has_obi?: boolean;
  label_type?: string;
  sort_by?: 'created_at' | 'price' | 'popularity' | 'label_type';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [
    'l.is_active = true', 
    'l.stock_quantity > 0', 
    'l.sold_at IS NULL',
    '(l.visible_from IS NULL OR l.visible_from <= NOW())',
    '(l.visible_until IS NULL OR l.visible_until >= NOW())'
  ];
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

  if (filters?.media_type) {
    conditions.push(`l.media_type = $${paramIndex}`);
    params.push(filters.media_type);
    paramIndex++;
  }

  if (filters?.has_obi !== undefined) {
    conditions.push(`l.has_obi = $${paramIndex}`);
    params.push(filters.has_obi);
    paramIndex++;
  }

  if (filters?.label_type) {
    conditions.push(`l.label_type = $${paramIndex}`);
    params.push(filters.label_type);
    paramIndex++;
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  // Determine sort order
  let orderBy = 'l.created_at DESC';
  if (filters?.sort_by) {
    const sortOrder = filters.sort_order || 'desc';
    switch (filters.sort_by) {
      case 'created_at':
        orderBy = `l.created_at ${sortOrder.toUpperCase()}`;
        break;
      case 'price':
        orderBy = `l.price ${sortOrder.toUpperCase()}`;
        break;
      case 'popularity':
        orderBy = `l.popularity_score ${sortOrder.toUpperCase()}`;
        break;
      case 'label_type':
        orderBy = `l.label_type ${sortOrder.toUpperCase()}, l.created_at DESC`;
        break;
    }
  }

  // Get total count for pagination
  const countResult = await pool.query(
    `SELECT COUNT(*) as total
     FROM listings.listings l
     LEFT JOIN listings.auction_details ad ON l.id = ad.listing_id AND l.listing_type = 'auction'
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  const result = await pool.query(
    `SELECT l.*, 
            (SELECT json_agg(
              json_build_object(
                'id', li.id,
                'image_url', li.image_url,
                'thumbnail_url', li.thumbnail_url,
                'is_primary', li.is_primary
              ) ORDER BY li.display_order
            ) FROM listings.listing_images li WHERE li.listing_id = l.id LIMIT 1) as primary_image,
            CASE 
              WHEN l.listing_type = 'auction' THEN json_build_object(
                'end_time', ad.end_time,
                'current_bid', ad.current_bid,
                'starting_bid', ad.starting_bid,
                'bid_count', ad.bid_count,
                'hours_remaining', EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600,
                'status', CASE 
                  WHEN ad.end_time < NOW() THEN 'ended'
                  WHEN EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600 < 1 THEN 'ending_soon'
                  WHEN EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600 < 24 THEN 'ending_today'
                  ELSE 'active'
                END
              )
              ELSE NULL
            END as auction_info,
            l.seller_rating,
            l.seller_rating_count,
            CASE 
              WHEN l.visible_from IS NOT NULL AND l.visible_until IS NOT NULL THEN json_build_object(
                'visible_from', l.visible_from,
                'visible_until', l.visible_until,
                'duration_days', l.duration_days,
                'days_remaining', EXTRACT(EPOCH FROM (l.visible_until - NOW())) / 86400
              )
              ELSE NULL
            END as visibility_timeline
     FROM listings.listings l
     LEFT JOIN listings.auction_details ad ON l.id = ad.listing_id AND l.listing_type = 'auction'
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    listings: result.rows,
    total,
    limit,
    offset,
    hasMore: offset + result.rows.length < total
  };
}

