/**
 * T15.4A — Compute owner-scoped AI features from live DB sources (no mocks).
 */
import type { Pool } from "pg";

export type AiSourceRef = {
  source_type: string;
  source_id: string;
  field?: string;
  freshness?: string;
};

export type AiFeatureRow = {
  feature_group: string;
  metrics: Record<string, unknown>;
  source_refs: AiSourceRef[];
  computed_at: string;
};

async function tableExists(pool: Pool, schema: string, table: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
    [schema, table],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function computeUserAiFeatures(
  userId: string,
  pools: { listings: Pool; records: Pool; analytics: Pool; shopping?: Pool },
): Promise<AiFeatureRow[]> {
  const features: AiFeatureRow[] = [];
  const now = new Date().toISOString();

  // OBO
  const obo = await pools.listings.query(
    `SELECT
       COUNT(*) FILTER (WHERE seller_user_id = $1)::int AS seller_offers,
       COUNT(*) FILTER (WHERE buyer_user_id = $1)::int AS buyer_offers,
       COUNT(*) FILTER (WHERE seller_user_id = $1 AND status IN ('pending','countered'))::int AS seller_pending,
       COUNT(*) FILTER (WHERE buyer_user_id = $1 AND status IN ('pending','countered'))::int AS buyer_pending,
       MAX(updated_at) AS last_offer_at
     FROM listings.offers
     WHERE seller_user_id = $1 OR buyer_user_id = $1`,
    [userId],
  );
  const orow = obo.rows[0] || {};
  if ((orow.seller_offers ?? 0) + (orow.buyer_offers ?? 0) > 0) {
    features.push({
      feature_group: "obo",
      metrics: {
        seller_offers: orow.seller_offers ?? 0,
        buyer_offers: orow.buyer_offers ?? 0,
        seller_pending: orow.seller_pending ?? 0,
        buyer_pending: orow.buyer_pending ?? 0,
      },
      source_refs: [{ source_type: "offer_summary", source_id: userId, freshness: orow.last_offer_at }],
      computed_at: now,
    });
  }

  // Auction (seller)
  const auction = await pools.listings.query(
    `SELECT
       COUNT(*)::int AS active_auctions,
       COALESCE(SUM(a.bid_count), 0)::int AS total_bids,
       MAX(a.updated_at) AS last_auction_at
     FROM listings.auction_settings a
     JOIN listings.listings l ON l.id = a.listing_id
     WHERE l.user_id = $1 AND a.status = 'active'`,
    [userId],
  );
  const arow = auction.rows[0] || {};
  if ((arow.active_auctions ?? 0) > 0) {
    features.push({
      feature_group: "auction",
      metrics: {
        active_auctions: arow.active_auctions ?? 0,
        total_bids_on_listings: arow.total_bids ?? 0,
      },
      source_refs: [{ source_type: "auction_bid_summary", source_id: userId, freshness: arow.last_auction_at }],
      computed_at: now,
    });
  }

  // Sales (listings)
  const sales = await pools.listings.query(
    `SELECT COUNT(*)::int AS active_listings, MAX(updated_at) AS last_listing_at
     FROM listings.listings WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  const srow = sales.rows[0] || {};
  features.push({
    feature_group: "sales",
    metrics: { active_listings: srow.active_listings ?? 0 },
    source_refs:
      (srow.active_listings ?? 0) > 0
        ? [{ source_type: "listing", source_id: userId, freshness: srow.last_listing_at }]
        : [],
    computed_at: now,
  });

  // Purchases (records collection)
  const purchases = await pools.records.query(
    `SELECT COUNT(*)::int AS owned_records,
            COUNT(*) FILTER (WHERE purchase_price_cents IS NOT NULL)::int AS priced_acquisitions,
            MAX(updated_at) AS last_record_at
     FROM records.records WHERE user_id = $1`,
    [userId],
  );
  const prow = purchases.rows[0] || {};
  if ((prow.owned_records ?? 0) > 0) {
    features.push({
      feature_group: "purchases",
      metrics: {
        owned_records: prow.owned_records ?? 0,
        priced_acquisitions: prow.priced_acquisitions ?? 0,
      },
      source_refs: [{ source_type: "record", source_id: userId, freshness: prow.last_record_at }],
      computed_at: now,
    });
  }

  // Watchlist + recently viewed (shopping DB when present)
  if (pools.shopping && (await tableExists(pools.shopping, "shopping", "watchlist"))) {
    const wl = await pools.shopping.query(
      `SELECT COUNT(*)::int AS items, MAX(updated_at) AS last_at
       FROM shopping.watchlist WHERE user_id = $1`,
      [userId],
    );
    const wrow = wl.rows[0] || {};
    if ((wrow.items ?? 0) > 0) {
      features.push({
        feature_group: "watchlist",
        metrics: { watchlist_items: wrow.items ?? 0 },
        source_refs: [{ source_type: "watchlist", source_id: userId, freshness: wrow.last_at }],
        computed_at: now,
      });
    }
  }

  if (pools.shopping && (await tableExists(pools.shopping, "shopping", "recently_viewed"))) {
    const rv = await pools.shopping.query(
      `SELECT COUNT(*)::int AS items, MAX(viewed_at) AS last_at
       FROM shopping.recently_viewed WHERE user_id = $1`,
      [userId],
    );
    const rvrow = rv.rows[0] || {};
    if ((rvrow.items ?? 0) > 0) {
      features.push({
        feature_group: "recently_viewed",
        metrics: { recently_viewed_items: rvrow.items ?? 0 },
        source_refs: [{ source_type: "recently_viewed", source_id: userId, freshness: rvrow.last_at }],
        computed_at: now,
      });
    }
  }

  // Listing revisions (seller edits)
  const revs = await pools.listings.query(
    `SELECT COUNT(*)::int AS revision_count, MAX(r.created_at) AS last_rev_at
     FROM listings.listing_revisions r
     JOIN listings.listings l ON l.id = r.listing_id
     WHERE l.user_id = $1`,
    [userId],
  );
  const rrow = revs.rows[0] || {};
  if ((rrow.revision_count ?? 0) > 0) {
    features.push({
      feature_group: "listing_revisions",
      metrics: { revision_count: rrow.revision_count ?? 0 },
      source_refs: [{ source_type: "listing_revision", source_id: userId, freshness: rrow.last_rev_at }],
      computed_at: now,
    });
  }

  return features.filter((f) => f.source_refs.length > 0 || f.feature_group === "sales");
}

export async function upsertUserAiFeatures(
  analyticsPool: Pool,
  userId: string,
  features: AiFeatureRow[],
): Promise<void> {
  for (const f of features) {
    await analyticsPool.query(
      `INSERT INTO analytics.ai_user_features (user_id, feature_group, metrics, source_refs, computed_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz)
       ON CONFLICT (user_id, feature_group) DO UPDATE SET
         metrics = EXCLUDED.metrics,
         source_refs = EXCLUDED.source_refs,
         computed_at = EXCLUDED.computed_at`,
      [userId, f.feature_group, JSON.stringify(f.metrics), JSON.stringify(f.source_refs), f.computed_at],
    );
  }
}

export async function getUserAiFeatures(analyticsPool: Pool, userId: string): Promise<AiFeatureRow[]> {
  const r = await analyticsPool.query(
    `SELECT feature_group, metrics, source_refs, computed_at
     FROM analytics.ai_user_features WHERE user_id = $1 ORDER BY feature_group`,
    [userId],
  );
  return r.rows.map((row) => ({
    feature_group: row.feature_group,
    metrics: row.metrics,
    source_refs: row.source_refs,
    computed_at: row.computed_at,
  }));
}
