import { Pool } from 'pg';
import { withRetry } from './db.js';

// Create a separate pool for listings DB queries
// Listings database is on port 5435 (record-platform-postgres-listings-1)
// Connection string format: postgresql://user:password@host:port/database
export const listingsPool = new Pool({
  connectionString: process.env.POSTGRES_URL_LISTINGS || 
    'postgresql://postgres:postgres@host.docker.internal:5435/records',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Remove sold-out items from all users' carts (except the buyer)
 * Called when an item is purchased/checked out
 */
export async function removeSoldOutFromCarts(
  pool: Pool,
  itemType: string,
  itemId: string,
  buyerUserId: string
): Promise<number> {
  try {
    // Remove from all carts except the buyer's
    const result = await pool.query(
      `DELETE FROM shopping.shopping_cart
       WHERE item_type = $1 
         AND item_id = $2::uuid
         AND user_id != $3::uuid
       RETURNING id`,
      [itemType, itemId, buyerUserId]
    );

    return result.rowCount || 0;
  } catch (err) {
    console.error('[shopping] Error removing sold-out items from carts:', err);
    return 0;
  }
}

/**
 * Check if items in cart are still available
 * Returns list of unavailable items
 */
export async function checkCartAvailability(
  pool: Pool,
  userId: string
): Promise<Array<{ cartItemId: string; itemId: string; itemType: string; reason: string }>> {
  // Use the same pool for listings queries (listings schema is in records DB)
  try {
    // Get all cart items (with retry for connection errors)
    const cartItems = await withRetry(
      () => pool.query(
        `SELECT id, item_type, item_id, listing_id
         FROM shopping.shopping_cart
         WHERE user_id = $1`,
        [userId]
      ),
      3,
      'get cart items for availability check'
    );

    const unavailable: Array<{ cartItemId: string; itemId: string; itemType: string; reason: string }> = [];

    for (const item of cartItems.rows) {
      if (item.item_type === 'listing' && item.listing_id) {
        // Check listing availability (using listings DB pool - listings DB is on port 5435)
        // Add timeout to prevent hanging
        try {
          const listing = await Promise.race([
            listingsPool.query(
              `SELECT is_active, sold_at, stock_quantity
               FROM listings.listings
               WHERE id = $1::uuid`,
              [item.listing_id]
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Listings DB query timeout')), 2000))
          ]) as any;

          if (listing.rows.length === 0) {
            unavailable.push({
              cartItemId: item.id,
              itemId: item.item_id,
              itemType: item.item_type,
              reason: 'Listing not found',
            });
          } else {
            const listingData = listing.rows[0];
            if (!listingData.is_active || listingData.sold_at || listingData.stock_quantity <= 0) {
              unavailable.push({
                cartItemId: item.id,
                itemId: item.item_id,
                itemType: item.item_type,
                reason: 'Item is sold out',
              });
            }
          }
        } catch (listingErr: any) {
          // If listings DB is unavailable, mark item as unavailable
          console.warn('[shopping] Could not check listing availability:', listingErr.message);
          unavailable.push({
            cartItemId: item.id,
            itemId: item.item_id,
            itemType: item.item_type,
            reason: 'Listing availability check failed',
          });
        }
      }
    }

    return unavailable;
  } catch (err) {
    console.error('[shopping] Error checking cart availability:', err);
    return [];
  }
}

/**
 * Clean up unavailable items from a user's cart
 */
export async function cleanupUnavailableItems(
  pool: Pool,
  userId: string
): Promise<number> {
  try {
    const unavailable = await checkCartAvailability(pool, userId);
    
    if (unavailable.length === 0) {
      return 0;
    }

    const cartItemIds = unavailable.map((item) => item.cartItemId);
    const result = await pool.query(
      `DELETE FROM shopping.shopping_cart
       WHERE id = ANY($1::uuid[])
         AND user_id = $2::uuid`,
      [cartItemIds, userId]
    );

    return result.rowCount || 0;
  } catch (err) {
    console.error('[shopping] Error cleaning up unavailable items:', err);
    return 0;
  }
}

/**
 * Mark watchlist/wishlist items as sold out (but keep them)
 * Updates metadata to indicate sold-out status
 */
export async function markWatchlistSoldOut(
  pool: Pool,
  itemType: string,
  itemId: string
): Promise<number> {
  try {
    // Update watchlist metadata - ensure metadata is valid JSON
    const watchlistResult = await pool.query(
      `UPDATE shopping.watchlist
       SET metadata = CASE 
         WHEN metadata IS NULL OR metadata::text = 'null' THEN '{"sold_out": true, "sold_out_at": $1}'::jsonb
         ELSE metadata || '{"sold_out": true, "sold_out_at": $1}'::jsonb
       END
       WHERE item_type = $2 AND item_id = $3::uuid`,
      [new Date().toISOString(), itemType, itemId]
    );

    // Update wishlist metadata - ensure metadata is valid JSON
    const wishlistResult = await pool.query(
      `UPDATE shopping.wishlist
       SET metadata = CASE 
         WHEN metadata IS NULL OR metadata::text = 'null' THEN '{"sold_out": true, "sold_out_at": $1}'::jsonb
         ELSE metadata || '{"sold_out": true, "sold_out_at": $1}'::jsonb
       END
       WHERE item_type = $2 AND item_id = $3::uuid`,
      [new Date().toISOString(), itemType, itemId]
    );

    return (watchlistResult.rowCount || 0) + (wishlistResult.rowCount || 0);
  } catch (err) {
    console.error('[shopping] Error marking watchlist/wishlist as sold out:', err);
    return 0;
  }
}

