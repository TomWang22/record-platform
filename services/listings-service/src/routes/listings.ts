import { Router } from 'express';
import { verifyJwt } from '@common/utils/auth';
import {
  getListingsByUser,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
  addListingImage,
  placeBid,
  makeOffer,
  addToWatchlist,
  removeFromWatchlist,
  getUserWatchlist,
} from '../lib/db.js';
import { handleListingsSearchHttp } from '../listings-search-http.js';
import { handleListingRevisionsHttp } from '../listings-revisions-http.js';
import { handleListingPatchHttp } from '../listings-patch-http.js';
import { createListingsHttpApp } from '../http-server.js';

/** Housing-schema GET /listings/:id (gateway + E2E contract). */
const listingsDetailHttp = createListingsHttpApp();

const router: Router = Router();

// Auth middleware (applied to routes that need auth)
function requireAuth(req: any, res: any, next: () => void) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'auth required' });
  }
  try {
    req.user = verifyJwt(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// Public browse/search (RP restored DB contract via search-listings-query.ts)
router.get('/search', (req, res) => void handleListingsSearchHttp(req, res));

// Protected routes below require authentication
router.use(requireAuth);

// Get user's listings (MUST be before /:id route to avoid matching "my-listings" as an ID)
router.get('/my-listings', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const listings = await getListingsByUser(userId, limit, offset);
    res.json({ listings, count: listings.length });
  } catch (err) {
    console.error('[listings] get my-listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Owner revision history (gateway: GET /api/listings/:id/revisions → /listings/:id/revisions)
router.get('/:id/revisions', (req, res) =>
  void handleListingRevisionsHttp(req as Parameters<typeof handleListingRevisionsHttp>[0], res),
);

router.patch('/:id', (req, res) =>
  void handleListingPatchHttp(req as Parameters<typeof handleListingPatchHttp>[0], res),
);

// Get listing by ID (housing schema; must be after /my-listings and /:id/revisions)
router.get('/:id', (req, res, next) => {
  const savedUrl = req.url;
  req.url = `/listings/${req.params.id}`;
  listingsDetailHttp(req, res, () => {
    req.url = savedUrl;
    next();
  });
});

// Legacy housing-era create removed — use POST /listings/create (price_cents contract).
router.post('/', (_req, res) => {
  res.status(410).json({
    error: 'Use POST /listings/create with price_cents (legacy price column removed)',
  });
});

// Update listing
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const updates: any = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.price !== undefined) updates.price = parseFloat(req.body.price);
    if (req.body.condition !== undefined) updates.condition = req.body.condition;
    if (req.body.catalog_id !== undefined) updates.catalog_id = req.body.catalog_id;
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.location !== undefined) updates.location = req.body.location;
    if (req.body.shipping_cost !== undefined) updates.shipping_cost = parseFloat(req.body.shipping_cost);
    if (req.body.shipping_method !== undefined) updates.shipping_method = req.body.shipping_method;
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

    const listing = await updateListing(req.params.id, userId, updates);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found or unauthorized' });
    }
    res.json(listing);
  } catch (err) {
    console.error('[listings] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete listing (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const deleted = await deleteListing(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Listing not found or unauthorized' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('[listings] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add image to listing
router.post('/:id/images', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    if (!req.body?.image_url || typeof req.body.image_url !== 'string') {
      return res.status(400).json({ error: 'image_url is required' });
    }
    // Verify ownership
    const listing = await getListingById(req.params.id);
    if (!listing || listing.user_id !== userId) {
      return res.status(404).json({ error: 'Listing not found or unauthorized' });
    }

    const image = await addListingImage(req.params.id, {
      image_url: req.body.image_url,
      image_path: req.body.image_path,
      thumbnail_url: req.body.thumbnail_url,
      file_size: req.body.file_size,
      mime_type: req.body.mime_type,
      width: req.body.width,
      height: req.body.height,
      display_order: req.body.display_order || 0,
      is_primary: req.body.is_primary || false,
    });
    res.status(201).json(image);
  } catch (err) {
    console.error('[listings] add image error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Place bid (auction)
router.post('/:id/bid', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const bidAmount = parseFloat(req.body.bid_amount);
    if (!bidAmount || bidAmount <= 0) {
      return res.status(400).json({ error: 'Invalid bid amount' });
    }

    const bid = await placeBid(req.params.id, userId, bidAmount);
    res.status(201).json(bid);
  } catch (err) {
    console.error('[listings] place bid error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
});

// Make offer (OBO/Best Offer)
router.post('/:id/offer', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const offerAmount = parseFloat(req.body.offer_amount);
    if (!offerAmount || offerAmount <= 0) {
      return res.status(400).json({ error: 'Invalid offer amount' });
    }

    const offer = await makeOffer(req.params.id, userId, offerAmount, req.body.message);
    res.status(201).json(offer);
  } catch (err) {
    console.error('[listings] make offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add to watchlist
router.post('/:id/watch', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const watchlistItem = await addToWatchlist(userId, req.params.id);
    if (!watchlistItem) {
      return res.status(200).json({ message: 'Already in watchlist' });
    }
    res.status(201).json(watchlistItem);
  } catch (err) {
    console.error('[listings] add to watchlist error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove from watchlist
router.delete('/:id/watch', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const removed = await removeFromWatchlist(userId, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Not in watchlist' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('[listings] remove from watchlist error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's watchlist
router.get('/watchlist/mine', async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const watchlist = await getUserWatchlist(userId);
    res.json({ watchlist, count: watchlist.length });
  } catch (err) {
    console.error('[listings] get watchlist error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

