import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

type SeedEvent = Record<string, unknown>

function seedCandidatePaths(): string[] {
  const cwd = process.cwd()
  const explicit = process.env.PHASE34_COMPLETED_SALES_SEED_PATH
  return [
    ...(explicit ? [path.resolve(cwd, explicit)] : []),
    path.join(cwd, '.data', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, 'scripts', 'ai-platform', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, '..', 'scripts', 'ai-platform', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, '..', 'webapp', '.data', 'phase34-owner-proof-completed-sales.live.json'),
  ]
}

function loadSeedEvents(): SeedEvent[] {
  for (const p of seedCandidatePaths()) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw) as { events?: SeedEvent[] } | SeedEvent[]
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed.events)) return parsed.events
    } catch {
      continue
    }
  }
  return []
}

function eventMatchesQuery(event: SeedEvent, q: string, artist: string, catalog: string): boolean {
  const hay = [
    event.artist,
    event.title,
    event.catalog_number,
    event.label,
    event.source_listing_id,
    event.listing_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (catalog) {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const evCat = norm(String(event.catalog_number || ''))
    if (evCat && evCat === norm(catalog)) return true
  }
  if (artist && hay.includes(artist.toLowerCase())) return true
  if (q) {
    const tokens = q
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1)
    if (tokens.length && tokens.every((t) => hay.includes(t))) return true
  }
  // No filters → return all authorized seed events (owner-proof gather).
  return !q && !artist && !catalog
}

/**
 * Authorized completed-sale seed events for Phase 34 owner-proof evidence assembly.
 * Never treats archived listings as sales — returns distinct COMPLETED_SALE events only.
 * Requires Authorization (contract / session). Empty when no seed file is present.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const artist = request.nextUrl.searchParams.get('artist')?.trim() ?? ''
  const catalog =
    request.nextUrl.searchParams.get('catalog')?.trim() ||
    request.nextUrl.searchParams.get('catalog_number')?.trim() ||
    ''

  const events = loadSeedEvents()
    .filter((e) => String(e.event_type || '').toUpperCase() === 'COMPLETED_SALE')
    .filter((e) => eventMatchesQuery(e, q, artist, catalog))
    .map((e) => ({
      market_event_id: e.market_event_id ?? null,
      source_event_id: e.source_event_id ?? null,
      source_listing_id: e.source_listing_id ?? e.listing_id ?? null,
      listing_id: e.listing_id ?? e.source_listing_id ?? null,
      event_type: 'COMPLETED_SALE',
      artist: e.artist ?? null,
      title: e.title ?? null,
      catalog_number: e.catalog_number ?? null,
      label: e.label ?? null,
      price_normalized: e.price_normalized ?? e.price_original ?? null,
      price_original: e.price_original ?? null,
      currency_normalized: e.currency_normalized ?? e.currency_original ?? 'USD',
      currency_original: e.currency_original ?? 'USD',
      media_condition: e.media_condition ?? null,
      sold_at: e.sold_at ?? e.observed_at ?? null,
      observed_at: e.observed_at ?? e.sold_at ?? null,
      authorization_scope: e.authorization_scope ?? 'authenticated_market',
    }))

  return NextResponse.json({
    events,
    count: events.length,
    source: 'authorized_completed_sale_seed',
  })
}
