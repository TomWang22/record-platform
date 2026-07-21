import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

type SeedEvent = Record<string, unknown>

function syntheticSalesAllowed(): boolean {
  return (
    process.env.PHASE34_ALLOW_SYNTHETIC_SALES === '1' ||
    process.env.PHASE34_UNIT_TEST_HOOKS === '1'
  )
}

function seedCandidatePaths(): string[] {
  const cwd = process.cwd()
  const explicit = process.env.PHASE34_COMPLETED_SALES_SEED_PATH
  return [
    ...(explicit ? [path.resolve(cwd, explicit)] : []),
    '/tmp/phase34-owner-proof-completed-sales.live.json',
    path.join(cwd, '.data', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, 'webapp', '.data', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, 'scripts', 'ai-platform', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, '..', 'scripts', 'ai-platform', 'phase34-owner-proof-completed-sales.live.json'),
    path.join(cwd, '..', 'webapp', '.data', 'phase34-owner-proof-completed-sales.live.json'),
  ]
}

function settlementStorePaths(): string[] {
  const cwd = process.cwd()
  const explicit = process.env.PHASE34_SALE_COMPLETED_STORE_PATH
  return [
    ...(explicit ? [path.resolve(cwd, explicit)] : []),
    '/tmp/phase34-sale-completed-events.json',
    path.join(cwd, '.data', 'phase34-sale-completed-events.json'),
    path.join(cwd, 'webapp', '.data', 'phase34-sale-completed-events.json'),
  ]
}

function loadJsonEvents(paths: string[]): SeedEvent[] {
  for (const p of paths) {
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
  return !q && !artist && !catalog
}

function projectEvent(e: SeedEvent, eventType: 'SALE_COMPLETED' | 'COMPLETED_SALE') {
  return {
    market_event_id: e.market_event_id ?? null,
    sale_event_id: e.sale_event_id ?? null,
    source_event_id: e.source_event_id ?? null,
    source_listing_id: e.source_listing_id ?? e.listing_id ?? null,
    listing_id: e.listing_id ?? e.source_listing_id ?? null,
    event_type: eventType,
    settlement_source:
      (typeof e.settlement_source === 'string' ? e.settlement_source : null) ??
      (e.provenance &&
      typeof e.provenance === 'object' &&
      'settlement_source' in e.provenance &&
      typeof (e.provenance as { settlement_source?: unknown }).settlement_source === 'string'
        ? (e.provenance as { settlement_source: string }).settlement_source
        : null),
    artist: e.artist ?? null,
    title: e.title ?? null,
    catalog_number: e.catalog_number ?? null,
    label: e.label ?? null,
    price_normalized: e.price_normalized ?? e.price_original ?? e.final_price ?? null,
    price_original: e.price_original ?? null,
    currency_normalized: e.currency_normalized ?? e.currency_original ?? e.currency ?? 'USD',
    currency_original: e.currency_original ?? e.currency ?? 'USD',
    media_condition: e.media_condition ?? null,
    sold_at: e.sold_at ?? e.observed_at ?? e.completed_at ?? null,
    observed_at: e.observed_at ?? e.sold_at ?? e.completed_at ?? null,
    authorization_scope: e.authorization_scope ?? 'first_party_settlement',
    evidence_snapshot_id: e.evidence_snapshot_id ?? null,
    evidence_snapshot_hash: e.evidence_snapshot_hash ?? null,
  }
}

/**
 * Completed-sale evidence API (Phase A).
 *
 * Default (live): returns settlement-grade SALE_COMPLETED events only.
 * Seed COMPLETED_SALE JSON is not production evidence and is unreachable
 * unless PHASE34_ALLOW_SYNTHETIC_SALES=1 or PHASE34_UNIT_TEST_HOOKS=1.
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

  const settlementEvents = loadJsonEvents(settlementStorePaths())
    .filter((e) => String(e.event_type || '').toUpperCase() === 'SALE_COMPLETED')
    .filter((e) => eventMatchesQuery(e, q, artist, catalog))
    .map((e) => projectEvent(e, 'SALE_COMPLETED'))

  if (!syntheticSalesAllowed()) {
    return NextResponse.json({
      events: settlementEvents,
      count: settlementEvents.length,
      source: 'settlement_sale_completed',
      seed_completed_sale_reachable: false,
    })
  }

  const seedEvents = loadJsonEvents(seedCandidatePaths())
    .filter((e) => String(e.event_type || '').toUpperCase() === 'COMPLETED_SALE')
    .filter((e) => eventMatchesQuery(e, q, artist, catalog))
    .map((e) => projectEvent(e, 'COMPLETED_SALE'))

  return NextResponse.json({
    events: [...settlementEvents, ...seedEvents],
    count: settlementEvents.length + seedEvents.length,
    source: 'settlement_plus_authorized_completed_sale_seed',
    seed_completed_sale_reachable: true,
  })
}
