import type { APIRequestContext } from '@playwright/test'

import { createListingWithShipping } from './listing-contract'

const PLACEHOLDER = 'https://picsum.photos/seed/rp-collection-contract/400/400'

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

type RecordRow = {
  id: string
  artist?: string
  imageUrl?: string | null
  coverUrl?: string | null
  mediaPieces?: { urlOrPath?: string | null }[]
}

function recordHasImage(row: RecordRow): boolean {
  if (row.imageUrl || row.coverUrl) return true
  return (row.mediaPieces ?? []).some((m) => Boolean(m.urlOrPath))
}

async function patchRecordMedia(
  request: APIRequestContext,
  token: string,
  recordId: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  await request.put(`/api/records/${recordId}`, {
    headers,
    data: {
      purchasedAt: '2026-05-01T00:00:00Z',
      shippedAt: '2026-05-03T00:00:00Z',
      receivedAt: '2026-05-05T00:00:00Z',
      mediaPieces: [{ kind: 'VINYL', index: 1, urlOrPath: PLACEHOLDER }],
    },
  })
}

function listingRecordId(listing: {
  source_record_id?: string | null
  amenities?: string[] | Record<string, unknown> | null
}): string {
  if (listing.source_record_id) return String(listing.source_record_id)
  const amenities = listing.amenities
  if (Array.isArray(amenities)) {
    for (const item of amenities) {
      const s = String(item)
      if (s.startsWith('source_record_id:')) {
        return s.slice('source_record_id:'.length).trim()
      }
    }
  }
  return ''
}

async function ensureKennyListed(
  request: APIRequestContext,
  token: string,
  records: RecordRow[],
): Promise<void> {
  const kennys = records.filter((r) => r.artist === 'Kenny Dorham' && r.id)
  if (kennys.length === 0) return

  const headers = { Authorization: `Bearer ${token}` }
  const mine = await request.get('/api/listings/mine', { headers })
  if (!mine.ok()) return
  const body = (await mine.json()) as {
    items?: {
      id: string
      source_record_id?: string | null
      amenities?: string[] | Record<string, unknown> | null
    }[]
    listings?: {
      id: string
      source_record_id?: string | null
      amenities?: string[] | Record<string, unknown> | null
    }[]
  }
  const rows = body.items ?? body.listings ?? []
  const linked = new Set(rows.map((l) => listingRecordId(l)).filter(Boolean))

  for (const kenny of kennys) {
    if (linked.has(kenny.id)) continue
    await createListingWithShipping(request, token, {
      title: `Quiet Kenny — collection contract ${kenny.id.slice(0, 8)}`,
      source_record_id: kenny.id,
    })
    linked.add(kenny.id)
  }
}

/** Ensure Test Collector has catalog rows so /records E2E is deterministic. */
export async function ensureTestCollection(
  request: APIRequestContext,
  token: string,
): Promise<number> {
  const headers = { Authorization: `Bearer ${token}` }
  const list = await request.get('/api/records', { headers })
  if (!list.ok()) return 0
  let existing = (await list.json()) as RecordRow[]
  if (Array.isArray(existing) && existing.length > 0) {
    const haveArtist = new Set(existing.map((r) => r.artist).filter(Boolean))
    for (const row of SEED_RECORDS) {
      if (haveArtist.has(row.artist)) continue
      const res = await request.post('/api/records', {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
          ...row,
          purchasedAt: '2026-05-01T00:00:00Z',
          shippedAt: '2026-05-03T00:00:00Z',
          receivedAt: '2026-05-05T00:00:00Z',
          purchaseSource: 'eBay',
          sellerName: 'Seed Seller',
          mediaPieces: [{ kind: 'VINYL', index: 1, urlOrPath: PLACEHOLDER }],
        },
      })
      if (res.ok()) {
        const body = (await res.json()) as RecordRow
        if (body.id) existing.push(body)
      }
    }
    for (const row of existing.filter((r) => SEED_RECORDS.some((s) => s.artist === r.artist))) {
      if (row.id && !recordHasImage(row)) {
        await patchRecordMedia(request, token, row.id)
      }
    }
    await ensureKennyListed(request, token, existing)
    return existing.length
  }

  let created = 0
  const createdRows: RecordRow[] = []
  for (const row of SEED_RECORDS) {
    const res = await request.post('/api/records', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        ...row,
        purchasedAt: '2026-05-01T00:00:00Z',
        shippedAt: '2026-05-03T00:00:00Z',
        receivedAt: '2026-05-05T00:00:00Z',
        purchaseSource: 'eBay',
        sellerName: 'Seed Seller',
        mediaPieces: [{ kind: 'VINYL', index: 1, urlOrPath: PLACEHOLDER }],
      },
    })
    if (res.ok()) {
      created += 1
      const body = (await res.json()) as RecordRow
      if (body.id) createdRows.push(body)
    }
  }
  if (createdRows.length > 0) {
    await ensureKennyListed(request, token, createdRows)
  }
  return created
}
