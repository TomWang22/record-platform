/**
 * Phase 34B — live market evidence assembly for scarcity / valuation.
 * Pure classification + mapping. Network I/O lives in ai-market-evidence.ts.
 *
 * Honest limits: platform-wide sold search does not exist. Sold evidence comes
 * from owner `/api/listings/mine` and optional auction-monitor results only.
 */

export type EvidenceMatchScope = 'exact_pressing' | 'release' | 'weak' | 'wrong_pressing' | 'excluded'

export type AssembledCandidate = {
  evidence_id: string
  source_id: string
  source_type: 'listing' | 'sale' | 'auction'
  sale_kind: 'sold' | 'asking'
  price: number
  currency: string
  pressing_id: string | null
  release_id: string
  condition: string | null
  observed_at: string | null
  retrieved_at: string
  summary: string
  authorization_scope: 'public_market' | 'authenticated_market' | 'owner_private'
  privacy_class: 'MARKETPLACE_SHARED' | 'OWNER_PRIVATE'
  deletion_state: 'ACTIVE' | 'DELETED'
  match_scope: EvidenceMatchScope
  catalog_number?: string | null
  artist?: string | null
  title?: string | null
  owner_principal_fixture?: string
  stale?: boolean
}

export type RecordSubjectInput = {
  id: string
  artist: string
  name: string
  format?: string | null
  catalogNumber?: string | null
  label?: string | null
  releaseYear?: number | null
  pressingYear?: number | null
  recordGrade?: string | null
  country?: string | null
}

export type ListingEvidenceInput = {
  id: string
  title?: string | null
  artist?: string | null
  catalogNumber?: string | null
  catalog_number?: string | null
  label?: string | null
  format?: string | null
  price?: number | null
  currency?: string | null
  status?: string | null
  listing_status?: string | null
  mediaCondition?: string | null
  grade?: string | null
  sold_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  listed_at?: string | null
  source_record_id?: string | null
  deleted_at?: string | null
  pressingYear?: number | string | null
  amenities?: unknown
}

export type AuctionResultInput = {
  id?: string
  title?: string | null
  price?: number | null
  total_cost?: number | null
  currency?: string | null
  sold_at?: string | null
  created_at?: string | null
}

/** Pre-seeded / authorized COMPLETED_SALE market events (never archived listings). */
export type CompletedSaleEventInput = {
  market_event_id?: string | null
  source_event_id?: string | null
  source_listing_id?: string | null
  listing_id?: string | null
  event_type?: string | null
  artist?: string | null
  title?: string | null
  catalog_number?: string | null
  label?: string | null
  price_normalized?: number | null
  price_original?: number | null
  price?: number | null
  currency_normalized?: string | null
  currency_original?: string | null
  currency?: string | null
  media_condition?: string | null
  condition?: string | null
  sold_at?: string | null
  observed_at?: string | null
  authorization_scope?: string | null
  pressing_id?: string | null
  release_id?: string | null
}

export type ScarcityAssemblyResult = {
  subject: {
    release_id: string
    pressing_id: string
    condition: string | null
    artist: string
    title: string
    catalog_number: string | null
    pressing_identity_confidence: 'exact' | 'ambiguous' | 'unknown'
  }
  candidates: AssembledCandidate[]
  pressing_candidates: AssembledCandidate[]
  release_candidates: AssembledCandidate[]
  active_supply_count: number
  recent_sale_count: number
  asking_count: number
  sold_count: number
  claim_rarity_from_zero_results: false
  require_exact_pressing: boolean
  authorized_scopes: string[]
  evidence_sources: string[]
  limitations: string[]
  assembler_version: string
}

export const MARKET_EVIDENCE_ASSEMBLER_VERSION = 'phase34b-market-evidence-v1'
const STALE_AFTER_MS = 180 * 24 * 60 * 60 * 1000

export function normalizeCatalog(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function releaseIdForRecord(record: RecordSubjectInput): string {
  return `release:${record.artist.trim()}:${record.name.trim()}`
}

export function pressingIdForRecord(record: RecordSubjectInput): {
  pressing_id: string
  confidence: 'exact' | 'ambiguous' | 'unknown'
} {
  const catalog = normalizeCatalog(record.catalogNumber)
  if (catalog) {
    return { pressing_id: `pressing:cat:${catalog}`, confidence: 'exact' }
  }
  if (record.pressingYear && record.format) {
    return {
      pressing_id: `pressing:yrfmt:${record.artist}|${record.name}|${record.pressingYear}|${record.format}`,
      confidence: 'ambiguous',
    }
  }
  return { pressing_id: `pressing:record:${record.id}`, confidence: 'unknown' }
}

function amenityMap(raw: unknown): Record<string, string> {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const item of raw) {
      const s = String(item).trim()
      const i = s.indexOf(':')
      if (i > 0) out[s.slice(0, i).trim().toLowerCase()] = s.slice(i + 1).trim()
    }
    return out
  }
  if (typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
    )
  }
  return {}
}

export function listingSourceRecordId(listing: ListingEvidenceInput): string | null {
  if (listing.source_record_id) return String(listing.source_record_id).trim() || null
  const map = amenityMap(listing.amenities)
  return map.source_record_id || null
}

export function listingCatalog(listing: ListingEvidenceInput): string | null {
  const raw = listing.catalogNumber ?? listing.catalog_number ?? amenityMap(listing.amenities).catalog_number
  return raw ? String(raw) : null
}

function statusOf(listing: ListingEvidenceInput): string {
  return String(listing.status ?? listing.listing_status ?? 'active').toLowerCase()
}

function isDeleted(listing: ListingEvidenceInput): boolean {
  return Boolean(listing.deleted_at) || statusOf(listing) === 'deleted'
}

function isSoldStatus(listing: ListingEvidenceInput): boolean {
  // Archived/paused are delisted inventory — NOT completed sales.
  const st = statusOf(listing)
  return st === 'sold' || st === 'closed'
}

function isActiveAsking(listing: ListingEvidenceInput): boolean {
  if (isDeleted(listing) || isSoldStatus(listing)) return false
  const st = statusOf(listing)
  return st === 'active' || st === 'published' || st === ''
}

function textHaystack(listing: ListingEvidenceInput): string {
  return [listing.title, listing.artist, listing.label, listingCatalog(listing)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function classifyListingMatch(
  record: RecordSubjectInput,
  listing: ListingEvidenceInput,
): EvidenceMatchScope {
  if (isDeleted(listing)) return 'excluded'

  const sourceRecordId = listingSourceRecordId(listing)
  if (sourceRecordId && sourceRecordId === record.id) return 'exact_pressing'

  const recordCat = normalizeCatalog(record.catalogNumber)
  const listingCat = normalizeCatalog(listingCatalog(listing))
  if (recordCat && listingCat) {
    if (recordCat === listingCat) return 'exact_pressing'
    return 'wrong_pressing'
  }

  const artist = record.artist.trim().toLowerCase()
  const title = record.name.trim().toLowerCase()
  const hay = textHaystack(listing)
  const artistOk = artist.length >= 2 && hay.includes(artist)
  const titleOk = title.length >= 2 && hay.includes(title)
  if (artistOk && titleOk) return 'release'

  // Catalog present on record but listing has none — cannot claim exact pressing.
  if (recordCat && !listingCat && artistOk && titleOk) return 'release'

  return 'weak'
}

function observedAt(listing: ListingEvidenceInput, saleKind: 'sold' | 'asking'): string | null {
  if (saleKind === 'sold') {
    return listing.sold_at || listing.updated_at || listing.created_at || null
  }
  return listing.listed_at || listing.created_at || listing.updated_at || null
}

export function mapListingToCandidate(
  record: RecordSubjectInput,
  listing: ListingEvidenceInput,
  opts: {
    saleKind: 'sold' | 'asking'
    nowMs?: number
    ownerPrivate?: boolean
  },
): AssembledCandidate | null {
  if (isDeleted(listing)) return null
  const price = Number(listing.price)
  if (!Number.isFinite(price) || price <= 0) return null

  const match = classifyListingMatch(record, listing)
  if (match === 'excluded' || match === 'wrong_pressing' || match === 'weak') return null

  const release_id = releaseIdForRecord(record)
  const { pressing_id } = pressingIdForRecord(record)
  const nowMs = opts.nowMs ?? Date.now()
  const observed = observedAt(listing, opts.saleKind)
  const observedMs = observed ? Date.parse(observed) : NaN
  const stale = Number.isFinite(observedMs) && nowMs - observedMs > STALE_AFTER_MS

  return {
    evidence_id: `listing:${listing.id}:${opts.saleKind}`,
    source_id: listing.id,
    source_type: opts.saleKind === 'sold' ? 'sale' : 'listing',
    sale_kind: opts.saleKind,
    price,
    currency: listing.currency || 'USD',
    pressing_id: match === 'exact_pressing' ? pressing_id : null,
    release_id,
    condition: listing.mediaCondition || listing.grade || null,
    observed_at: observed,
    retrieved_at: new Date(nowMs).toISOString(),
    summary: `${opts.saleKind === 'sold' ? 'Sold' : 'Asking'} ${listing.title || listing.id} for ${price} ${listing.currency || 'USD'}`,
    authorization_scope: opts.ownerPrivate ? 'owner_private' : 'public_market',
    privacy_class: opts.ownerPrivate ? 'OWNER_PRIVATE' : 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    match_scope: match,
    catalog_number: listingCatalog(listing),
    artist: listing.artist || null,
    title: listing.title || null,
    stale,
  }
}

export function mapAuctionResultToCandidate(
  record: RecordSubjectInput,
  row: AuctionResultInput,
  opts: { nowMs?: number; index: number },
): AssembledCandidate | null {
  const price = Number(row.price ?? row.total_cost)
  if (!Number.isFinite(price) || price <= 0) return null
  const title = String(row.title || '').toLowerCase()
  const artist = record.artist.trim().toLowerCase()
  const name = record.name.trim().toLowerCase()
  if (!title.includes(artist) || !title.includes(name)) return null

  const nowMs = opts.nowMs ?? Date.now()
  const observed = row.sold_at || row.created_at || null
  const observedMs = observed ? Date.parse(observed) : NaN
  const stale = Number.isFinite(observedMs) && nowMs - observedMs > STALE_AFTER_MS
  const id = row.id || `auction-${opts.index}`

  return {
    evidence_id: `auction:${id}:sold`,
    source_id: String(id),
    source_type: 'auction',
    sale_kind: 'sold',
    price,
    currency: row.currency || 'USD',
    pressing_id: null,
    release_id: releaseIdForRecord(record),
    condition: null,
    observed_at: observed,
    retrieved_at: new Date(nowMs).toISOString(),
    summary: `Auction sold ${row.title} for ${price} ${row.currency || 'USD'}`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    match_scope: 'release',
    stale,
  }
}

function completedSaleMatchesRecord(
  record: RecordSubjectInput,
  event: CompletedSaleEventInput,
): EvidenceMatchScope {
  const recCat = normalizeCatalog(record.catalogNumber)
  const evCat = normalizeCatalog(event.catalog_number)
  if (recCat && evCat && recCat === evCat) return 'exact_pressing'

  const artist = record.artist.trim().toLowerCase()
  const name = record.name.trim().toLowerCase()
  const hay = [event.artist, event.title, event.label, event.catalog_number]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (artist && name && hay.includes(artist) && hay.includes(name)) return 'release'
  if (artist && hay.includes(artist)) return 'weak'
  return 'excluded'
}

/**
 * Map a normalized COMPLETED_SALE market event into an assembled sold candidate.
 * Always sale_kind=sold + source_type=sale — never "listing".
 */
export function mapCompletedSaleEventToCandidate(
  record: RecordSubjectInput,
  event: CompletedSaleEventInput,
  opts: { nowMs?: number; index?: number } = {},
): AssembledCandidate | null {
  const eventType = String(event.event_type || 'COMPLETED_SALE').toUpperCase()
  if (
    eventType &&
    eventType !== 'COMPLETED_SALE' &&
    eventType !== 'SALE_COMPLETED' &&
    eventType !== 'AUCTION_COMPLETED'
  ) {
    return null
  }
  const price = Number(event.price_normalized ?? event.price_original ?? event.price)
  if (!Number.isFinite(price) || price <= 0) return null

  const match = completedSaleMatchesRecord(record, event)
  if (match === 'excluded' || match === 'wrong_pressing' || match === 'weak') return null

  const nowMs = opts.nowMs ?? Date.now()
  const observed = event.sold_at || event.observed_at || null
  const observedMs = observed ? Date.parse(observed) : NaN
  const stale = Number.isFinite(observedMs) && nowMs - observedMs > STALE_AFTER_MS
  const listingId = event.source_listing_id || event.listing_id || null
  const eventId =
    event.market_event_id ||
    event.source_event_id ||
    listingId ||
    `completed-sale-${opts.index ?? 0}`
  const { pressing_id } = pressingIdForRecord(record)
  const release_id = event.release_id || releaseIdForRecord(record)
  const currency = event.currency_normalized || event.currency_original || event.currency || 'USD'
  const title = event.title || record.name

  return {
    evidence_id: `sale:${eventId}`,
    source_id: String(listingId || eventId),
    source_type: 'sale',
    sale_kind: 'sold',
    price,
    currency,
    pressing_id: match === 'exact_pressing' ? pressing_id : null,
    release_id,
    condition: event.media_condition || event.condition || null,
    observed_at: observed,
    retrieved_at: new Date(nowMs).toISOString(),
    summary: `Sold ${title} for ${price} ${currency}`,
    authorization_scope:
      event.authorization_scope === 'public_market' ||
      event.authorization_scope === 'owner_private'
        ? event.authorization_scope
        : 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    match_scope: match,
    catalog_number: event.catalog_number || null,
    artist: event.artist || null,
    title: event.title || null,
    stale,
  }
}

export function assembleScarcityEvidence(input: {
  record: RecordSubjectInput
  activeListings?: ListingEvidenceInput[]
  ownerListings?: ListingEvidenceInput[]
  auctionResults?: AuctionResultInput[]
  /** Authorized pre-seeded COMPLETED_SALE events (owner-proof / test-data path). */
  completedSaleEvents?: CompletedSaleEventInput[]
  nowMs?: number
}): ScarcityAssemblyResult {
  const { record } = input
  const nowMs = input.nowMs ?? Date.now()
  const { pressing_id, confidence } = pressingIdForRecord(record)
  const release_id = releaseIdForRecord(record)
  const limitations: string[] = []
  const evidence_sources: string[] = []

  const candidates: AssembledCandidate[] = []
  const seen = new Set<string>()

  const push = (c: AssembledCandidate | null) => {
    if (!c || seen.has(c.evidence_id)) return
    if (c.stale) {
      limitations.push(`Stale evidence excluded or flagged: ${c.evidence_id}`)
      // Keep stale as evidence but engine may mark STALE_SOURCE; still include with note
    }
    seen.add(c.evidence_id)
    candidates.push(c)
  }

  for (const listing of input.activeListings || []) {
    if (!isActiveAsking(listing)) continue
    push(
      mapListingToCandidate(record, listing, {
        saleKind: 'asking',
        nowMs,
        ownerPrivate: false,
      }),
    )
  }
  if ((input.activeListings || []).length) evidence_sources.push('listings_search_active')

  for (const listing of input.ownerListings || []) {
    if (isDeleted(listing)) continue
    if (isSoldStatus(listing)) {
      push(
        mapListingToCandidate(record, listing, {
          saleKind: 'sold',
          nowMs,
          ownerPrivate: true,
        }),
      )
    } else if (isActiveAsking(listing)) {
      push(
        mapListingToCandidate(record, listing, {
          saleKind: 'asking',
          nowMs,
          ownerPrivate: true,
        }),
      )
    }
    // paused/archived without a true sold/closed status: neither asking nor sold
  }
  if ((input.ownerListings || []).length) evidence_sources.push('listings_mine_owner')

  ;(input.auctionResults || []).forEach((row, index) => {
    push(mapAuctionResultToCandidate(record, row, { nowMs, index }))
  })
  if ((input.auctionResults || []).length) evidence_sources.push('auction_monitor_results')

  ;(input.completedSaleEvents || []).forEach((event, index) => {
    push(mapCompletedSaleEventToCandidate(record, event, { nowMs, index }))
  })
  if ((input.completedSaleEvents || []).length) {
    evidence_sources.push('authorized_completed_sale_events')
  }

  const pressing_candidates = candidates.filter((c) => c.match_scope === 'exact_pressing')
  const release_candidates = candidates.filter((c) => c.match_scope === 'release')
  // Hard distinction: asking never contributes to sold_count.
  const asking_count = candidates.filter((c) => c.sale_kind === 'asking').length
  const sold_count = candidates.filter((c) => c.sale_kind === 'sold').length
  const active_supply_count = pressing_candidates.filter((c) => c.sale_kind === 'asking').length
  const recent_sale_count = candidates.filter((c) => c.sale_kind === 'sold' && !c.stale).length

  if (confidence !== 'exact') {
    limitations.push(
      confidence === 'ambiguous'
        ? 'Exact pressing identity is ambiguous (no catalog number); release-level evidence preferred.'
        : 'Exact pressing identity unknown; scarcity will abstain rather than invent rarity.',
    )
  }
  if (sold_count === 0) {
    limitations.push(
      'No platform-wide sold-listing search exists; sold evidence limited to owner listings, auction-monitor matches, and authorized completed-sale events.',
    )
  }
  if (asking_count === 0 && sold_count === 0) {
    limitations.push('No live comparable evidence assembled; engine must abstain.')
  }

  const bootlegHit = [...(input.activeListings || []), ...(input.ownerListings || [])].some((l) =>
    /bootleg|counterfeit|unofficial\s+press/i.test(textHaystack(l)),
  )
  if (bootlegHit) {
    limitations.push(
      'Bootleg/counterfeit warning: at least one comparable title mentions unofficial/bootleg/counterfeit stock — do not treat as official pressing scarcity.',
    )
  }

  const deletedExcluded = [...(input.activeListings || []), ...(input.ownerListings || [])].filter(
    isDeleted,
  ).length
  if (deletedExcluded > 0) {
    limitations.push(`Excluded ${deletedExcluded} deleted listing(s) from evidence.`)
  }

  // Zero inventory alone never means rare — always false.
  const claim_rarity_from_zero_results = false as const

  return {
    subject: {
      release_id,
      pressing_id,
      condition: record.recordGrade || null,
      artist: record.artist,
      title: record.name,
      catalog_number: record.catalogNumber || null,
      pressing_identity_confidence: confidence,
    },
    candidates,
    pressing_candidates,
    release_candidates,
    active_supply_count,
    recent_sale_count,
    asking_count,
    sold_count,
    claim_rarity_from_zero_results,
    require_exact_pressing: confidence === 'exact',
    authorized_scopes: ['public_market', 'authenticated_market', 'owner_private'],
    evidence_sources,
    limitations,
    assembler_version: MARKET_EVIDENCE_ASSEMBLER_VERSION,
  }
}

/** Valuation uses the same candidates with sold/asking kept distinct. */
export function assembleValuationEvidence(input: Parameters<typeof assembleScarcityEvidence>[0]) {
  const scarcity = assembleScarcityEvidence(input)
  return {
    ...scarcity,
    min_sold_comps: 2,
    currency: 'USD',
  }
}
