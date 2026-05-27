import type { APIRequestContext } from '@playwright/test'

const SEED_RECORDS = [
  {
    artist: 'Kenny Dorham',
    name: 'Quiet Kenny',
    format: 'LP',
    catalogNumber: 'BLP 1569',
    label: 'Blue Note',
    purchaseType: 'auction_win',
    purchasePriceCents: 4599,
    purchaseCurrency: 'USD',
  },
  {
    artist: 'Art Blakey',
    name: 'Moanin',
    format: 'LP',
    catalogNumber: 'BLP 4003',
    label: 'Blue Note',
    purchaseType: 'fixed_price',
    purchasePriceCents: 3200,
    purchaseCurrency: 'USD',
  },
  {
    artist: 'Miles Davis',
    name: 'Kind of Blue',
    format: 'LP',
    catalogNumber: 'CL 1355',
    label: 'Columbia',
    purchaseType: 'retail',
    purchasePriceCents: 2800,
    purchaseCurrency: 'USD',
  },
] as const

/** Ensure Test Collector has catalog rows so /records E2E is deterministic. */
export async function ensureTestCollection(
  request: APIRequestContext,
  token: string,
): Promise<number> {
  const headers = { Authorization: `Bearer ${token}` }
  const list = await request.get('/api/records', { headers })
  if (!list.ok()) return 0
  const existing = (await list.json()) as unknown[]
  if (Array.isArray(existing) && existing.length > 0) {
    return existing.length
  }

  let created = 0
  for (const row of SEED_RECORDS) {
    const res = await request.post('/api/records', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        ...row,
        purchasedAt: '2026-05-01T00:00:00Z',
        receivedAt: '2026-05-05T00:00:00Z',
        purchaseSource: 'eBay',
        sellerName: 'Seed Seller',
      },
    })
    if (res.ok()) created += 1
  }
  return created
}
