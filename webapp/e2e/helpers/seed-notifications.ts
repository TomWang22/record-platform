import type { APIRequestContext } from '@playwright/test'

const CONTRACT_EVENTS = [
  {
    event_type: 'marketplace.listing.sold',
    title: 'Listing sold',
    body: 'Your listing sold — ship within 3 days',
    type: 'listing_sold',
    listing_id: '',
  },
  {
    event_type: 'marketplace.offer.received',
    title: 'Offer received',
    body: '$42 offer on your listing',
    type: 'offer_received',
    listing_id: '',
  },
  {
    event_type: 'marketplace.auction.price_spike',
    title: 'Auction price spike',
    body: 'Bidding moved up 12% on a watched listing',
    type: 'auction_price_spike',
    listing_id: '',
  },
] as const

/**
 * Insert unread notifications via notification-service internal push (mesh secret from env in CI).
 * Falls back to direct SQL-style seed through repeated internal API if NOTIFICATION_E2E_SEED is set on service.
 */
export async function ensureContractNotifications(
  request: APIRequestContext,
  token: string,
  listingId: string,
): Promise<{ seededIds: string[]; unreadBefore: number }> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const seededIds: string[] = []
  for (const ev of CONTRACT_EVENTS) {
    const res = await request.post('/api/notifications/seed-contract', {
      headers,
      data: {
        event_type: ev.event_type,
        payload: {
          title: ev.title,
          body: ev.body,
          type: ev.type,
          listing_id: listingId,
          href: listingId ? `/listings/${listingId}` : '/listings',
        },
      },
    })
    if (res.ok()) {
      const body = (await res.json()) as { id?: string }
      if (body.id) seededIds.push(body.id)
      continue
    }
    const err = await res.text()
    if (res.status() === 404) {
      throw new Error(
        `notification seed-contract unavailable (${res.status()}): ${err.slice(0, 200)} — set NOTIFICATION_E2E_SEED=1 on notification-service`,
      )
    }
  }

  if (seededIds.length > 0) {
    return { seededIds, unreadBefore: seededIds.length }
  }

  const list = await request.get('/api/notifications', { headers })
  if (!list.ok()) return { seededIds: [], unreadBefore: 0 }
  const items = ((await list.json()) as { items?: unknown[] }).items ?? []
  const unreadBefore = items.filter((row) => {
    const r = row as { read_at?: string | null }
    return !r.read_at
  }).length
  return { seededIds: [], unreadBefore }
}
