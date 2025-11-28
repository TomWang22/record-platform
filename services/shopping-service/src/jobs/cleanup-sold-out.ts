import { Pool } from 'pg';
import { pool } from '../lib/db.js';
import { listingsPool, cleanupUnavailableItems } from '../lib/availability.js';

/**
 * Background job to periodically clean up sold-out items from all users' carts
 * This ensures that even if checkout didn't run cleanup, carts stay clean
 */
export async function cleanupAllSoldOutItems() {
  try {
    console.log('[shopping] Starting cleanup of sold-out items from all carts...');

    // Get all unique users with cart items
    const usersResult = await pool.query(
      `SELECT DISTINCT user_id FROM shopping.shopping_cart`
    );

    let totalRemoved = 0;

    for (const row of usersResult.rows) {
      const userId = row.user_id;
      const removed = await cleanupUnavailableItems(pool, userId);
      if (removed > 0) {
        totalRemoved += removed;
        console.log(`[shopping] Removed ${removed} unavailable items from user ${userId}'s cart`);
      }
    }

    console.log(`[shopping] Cleanup complete. Removed ${totalRemoved} items total.`);
    return totalRemoved;
  } catch (err) {
    console.error('[shopping] Error in cleanup job:', err);
    return 0;
  }
}

// Run cleanup every 5 minutes if running as a job
if (require.main === module) {
  setInterval(() => {
    void cleanupAllSoldOutItems();
  }, 5 * 60 * 1000); // 5 minutes

  // Run once immediately
  void cleanupAllSoldOutItems();
}

