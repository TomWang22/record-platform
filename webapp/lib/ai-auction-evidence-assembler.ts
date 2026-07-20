/**
 * Phase 34B — pure auction evidence assembly for single-lot + watchlist temperature.
 * Network I/O lives in ai-auction-evidence.ts.
 *
 * Hard rules:
 * - Never emit bidder identities / high-bidder / winner masks
 * - Never set claim_collusion / request_bidder_identity
 * - Separate asking (active) from sold/completed
 * - Exclude deleted; flag stale; bound watchlist batch size
 */

export const AUCTION_EVIDENCE_ASSEMBLER_VERSION = 'phase34b-auction-evidence-v1'
const STALE_AFTER_MS = 180 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_LOTS = 25

export type AuctionMatchScope = 'strong' | 'weak' | 'ambiguous' | 'excluded'

export type AuctionSubjectInput = {
  lot_id?: string | null
  listing_id?: string | null
  artist?: string | null
  title?: string | null
  catalog_number?: string | null
  release_id?: string | null
  pressing_id?: string | null
}

export type AuctionLotInput = {
  lot_id?: string | null
  listing_id?: string | null
  title?: string | null
  artist?: string | null
  catalog_number?: string | null
  current_price?: number | null
  currency?: string | null
  bid_count?: number | null
  bid_timestamps?: string[] | null
  end_at?: string | null
  time_left_ms?: number | null
  auction_state?: string | null
  deletion_state?: string | null
  deleted_at?: string | null
  observed_at?: string | null
  release_id?: string | null
  pressing_id?: string | null
  authorized?: boolean
  sale_kind?: 'asking' | 'sold' | 'completed' | string | null
  /** Must never be copied into assembled output. */
  high_bidder_masked?: string | null
  winner_masked?: string | null
}

export type AuctionCandidateLineage = {
  assembler_version: string
  source_lot_id: string
  source_listing_id: string | null
  match_scope: AuctionMatchScope
  sale_kind: 'asking' | 'sold' | 'completed'
}

export type AssembledAuctionCandidate = {
  evidence_id: string
  lot_id: string
  source_type: 'auction'
  source_id: string
  sale_kind: 'asking' | 'sold' | 'completed'
  current_price: number | null
  currency: string
  bid_count: number
  bid_velocity: number
  late_bid_pressure: number
  price_acceleration: number
  end_at: string | null
  observed_at: string | null
  retrieved_at: string
  deletion_state: 'ACTIVE' | 'DELETED'
  auction_state: string
  stale: boolean
  authorization_scope: 'authenticated_market' | 'owner_watchlist' | 'owner_private'
  privacy_class: 'MARKETPLACE_SHARED' | 'OWNER_PRIVATE'
  match_scope: AuctionMatchScope
  release_id: string | null
  pressing_id: string | null
  summary: string
  lineage: AuctionCandidateLineage
}

export type AssembledAuctionLotPayload = {
  lot_id: string
  listing_id: string | null
  current_price: number | null
  currency: string
  bid_count: number
  bid_velocity: number
  late_bid_pressure: number
  price_acceleration: number
  end_at: string | null
  time_left_ms?: number | null
  time_remaining: string | null
  observed_at: string | null
  deletion_state: 'ACTIVE' | 'DELETED'
  auction_state: string
  stale: boolean
  release_id: string | null
  pressing_id: string | null
}

function normalizeCatalog(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function statusOf(lot: AuctionLotInput): string {
  return String(lot.auction_state || '').toLowerCase()
}

function isDeleted(lot: AuctionLotInput): boolean {
  if (lot.deleted_at) return true
  if (String(lot.deletion_state || '').toUpperCase() === 'DELETED') return true
  const st = statusOf(lot)
  return st === 'deleted' || st === 'cancelled' || st === 'canceled'
}

function resolveSaleKind(lot: AuctionLotInput): 'asking' | 'sold' | 'completed' {
  const explicit = String(lot.sale_kind || '').toLowerCase()
  if (explicit === 'sold' || explicit === 'completed' || explicit === 'asking') {
    return explicit
  }
  const st = statusOf(lot)
  if (st === 'ended' || st === 'closed' || st === 'sold' || st === 'completed') {
    return st === 'sold' ? 'sold' : 'completed'
  }
  return 'asking'
}

function timeRemainingIso(timeLeftMs: number | null | undefined): string | null {
  if (timeLeftMs == null || !Number.isFinite(timeLeftMs) || timeLeftMs < 0) return null
  const hours = Math.floor(timeLeftMs / (60 * 60 * 1000))
  const minutes = Math.floor((timeLeftMs % (60 * 60 * 1000)) / (60 * 1000))
  if (hours <= 0 && minutes <= 0) return 'PT0M'
  if (hours <= 0) return `PT${minutes}M`
  if (minutes <= 0) return `PT${hours}H`
  return `PT${hours}H${minutes}M`
}

export function computeBidVelocityProxy(input: {
  bid_count?: number | null
  bid_timestamps?: string[] | null
  nowMs?: number
  windowHours?: number
}): number {
  const nowMs = input.nowMs ?? Date.now()
  const windowHours = input.windowHours ?? 6
  const windowMs = windowHours * 60 * 60 * 1000
  const stamps = (input.bid_timestamps || [])
    .map((t) => Date.parse(String(t)))
    .filter((t) => Number.isFinite(t) && nowMs - t <= windowMs)
  if (stamps.length >= 2) {
    const spanMs = Math.max(1, Math.max(...stamps) - Math.min(...stamps))
    const perHour = ((stamps.length - 1) / spanMs) * 60 * 60 * 1000
    return Math.max(0, Math.min(20, Math.round(perHour * 1000) / 1000))
  }
  const bidCount = Number(input.bid_count) || 0
  if (bidCount <= 0) return 0
  // Fallback density proxy when timestamps unavailable.
  return Math.max(0, Math.min(20, Math.round((bidCount / windowHours) * 1000) / 1000))
}

export function computeLateBidPressure(input: {
  bid_count?: number | null
  time_left_ms?: number | null
  bid_velocity?: number | null
}): number {
  const bidCount = Number(input.bid_count) || 0
  const velocity = Number(input.bid_velocity) || 0
  const timeLeft = input.time_left_ms
  if (bidCount <= 0) return 0
  let urgency = 0.2
  if (timeLeft != null && Number.isFinite(timeLeft)) {
    if (timeLeft <= 15 * 60 * 1000) urgency = 0.95
    else if (timeLeft <= 60 * 60 * 1000) urgency = 0.75
    else if (timeLeft <= 6 * 60 * 60 * 1000) urgency = 0.45
    else urgency = 0.2
  }
  const momentum = Math.min(1, velocity / 5)
  return Math.max(0, Math.min(1, Math.round((0.55 * urgency + 0.45 * momentum) * 1000) / 1000))
}

export function classifyAuctionCandidate(
  subject: AuctionSubjectInput,
  lot: AuctionLotInput,
): AuctionMatchScope {
  if (isDeleted(lot)) return 'excluded'
  if (lot.authorized === false) return 'excluded'

  const subjectCat = normalizeCatalog(subject.catalog_number)
  const lotCat = normalizeCatalog(lot.catalog_number)
  if (subjectCat && lotCat) {
    if (subjectCat === lotCat) return 'strong'
    return 'weak'
  }

  const artist = String(subject.artist || '')
    .trim()
    .toLowerCase()
  const title = String(subject.title || '')
    .trim()
    .toLowerCase()
  const hay = [lot.title, lot.artist, lot.catalog_number]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const artistOk = artist.length >= 2 && hay.includes(artist)
  const titleOk = title.length >= 2 && hay.includes(title)
  if (artistOk && titleOk && !subjectCat) return 'ambiguous'
  if (artistOk && titleOk) return 'strong'
  if (artistOk || titleOk) return 'weak'
  if (!artist && !title && (lot.lot_id || lot.listing_id)) return 'ambiguous'
  return 'weak'
}

function mapLotToCandidate(
  subject: AuctionSubjectInput,
  lot: AuctionLotInput,
  opts: {
    nowMs: number
    authorization_scope?: AssembledAuctionCandidate['authorization_scope']
    privacy_class?: AssembledAuctionCandidate['privacy_class']
  },
): AssembledAuctionCandidate | null {
  if (isDeleted(lot)) return null
  const match = classifyAuctionCandidate(subject, lot)
  if (match === 'excluded') return null

  const lotId = String(lot.lot_id || lot.listing_id || '').trim()
  if (!lotId) return null

  const saleKind = resolveSaleKind(lot)
  const bidCount = Number(lot.bid_count) || 0
  const bidVelocity = computeBidVelocityProxy({
    bid_count: bidCount,
    bid_timestamps: lot.bid_timestamps,
    nowMs: opts.nowMs,
  })
  const lateBidPressure = computeLateBidPressure({
    bid_count: bidCount,
    time_left_ms: lot.time_left_ms,
    bid_velocity: bidVelocity,
  })
  const price = lot.current_price != null && Number.isFinite(Number(lot.current_price))
    ? Number(lot.current_price)
    : null
  const observed = lot.observed_at || null
  const observedMs = observed ? Date.parse(observed) : NaN
  const stale = Number.isFinite(observedMs) && opts.nowMs - observedMs > STALE_AFTER_MS
  const listingId = lot.listing_id ? String(lot.listing_id) : null

  return {
    evidence_id: `auction:${lotId}:${saleKind}`,
    lot_id: lotId,
    source_type: 'auction',
    source_id: lotId,
    sale_kind: saleKind,
    current_price: price,
    currency: lot.currency || 'USD',
    bid_count: bidCount,
    bid_velocity: bidVelocity,
    late_bid_pressure: lateBidPressure,
    price_acceleration: Math.max(0, Math.min(1, bidVelocity / 10)),
    end_at: lot.end_at || null,
    observed_at: observed,
    retrieved_at: new Date(opts.nowMs).toISOString(),
    deletion_state: 'ACTIVE',
    auction_state: String(lot.auction_state || saleKind),
    stale,
    authorization_scope: opts.authorization_scope || 'authenticated_market',
    privacy_class: opts.privacy_class || 'MARKETPLACE_SHARED',
    match_scope: match,
    release_id: lot.release_id || subject.release_id || null,
    pressing_id: lot.pressing_id || subject.pressing_id || null,
    summary: `${saleKind === 'asking' ? 'Active auction' : 'Completed auction'} ${lot.title || lotId} · bids=${bidCount}`,
    lineage: {
      assembler_version: AUCTION_EVIDENCE_ASSEMBLER_VERSION,
      source_lot_id: lotId,
      source_listing_id: listingId,
      match_scope: match,
      sale_kind: saleKind,
    },
  }
}

function toLotPayload(
  lot: AuctionLotInput | null | undefined,
  candidate: AssembledAuctionCandidate | null,
  nowMs: number,
): AssembledAuctionLotPayload {
  if (!lot && !candidate) {
    return {
      lot_id: 'unknown',
      listing_id: null,
      current_price: null,
      currency: 'USD',
      bid_count: 0,
      bid_velocity: 0,
      late_bid_pressure: 0,
      price_acceleration: 0,
      end_at: null,
      time_remaining: null,
      observed_at: null,
      deletion_state: 'ACTIVE',
      auction_state: 'unknown',
      stale: false,
      release_id: null,
      pressing_id: null,
    }
  }
  if (lot && isDeleted(lot)) {
    return {
      lot_id: String(lot.lot_id || lot.listing_id || 'unknown'),
      listing_id: lot.listing_id ? String(lot.listing_id) : null,
      current_price: lot.current_price != null ? Number(lot.current_price) : null,
      currency: lot.currency || 'USD',
      bid_count: Number(lot.bid_count) || 0,
      bid_velocity: 0,
      late_bid_pressure: 0,
      price_acceleration: 0,
      end_at: lot.end_at || null,
      time_remaining: timeRemainingIso(lot.time_left_ms),
      observed_at: lot.observed_at || null,
      deletion_state: 'DELETED',
      auction_state: String(lot.auction_state || 'deleted'),
      stale: false,
      release_id: lot.release_id || null,
      pressing_id: lot.pressing_id || null,
    }
  }
  const c = candidate!
  const observedMs = c.observed_at ? Date.parse(c.observed_at) : NaN
  const stale = Number.isFinite(observedMs) && nowMs - observedMs > STALE_AFTER_MS
  return {
    lot_id: c.lot_id,
    listing_id: c.lineage.source_listing_id,
    current_price: c.current_price,
    currency: c.currency,
    bid_count: c.bid_count,
    bid_velocity: c.bid_velocity,
    late_bid_pressure: c.late_bid_pressure,
    price_acceleration: c.price_acceleration,
    end_at: c.end_at,
    time_left_ms: lot?.time_left_ms ?? null,
    time_remaining: timeRemainingIso(lot?.time_left_ms),
    observed_at: c.observed_at,
    deletion_state: c.deletion_state,
    auction_state: c.auction_state,
    stale,
    release_id: c.release_id,
    pressing_id: c.pressing_id,
  }
}

function pressingConfidence(subject: AuctionSubjectInput): 'exact' | 'ambiguous' | 'unknown' {
  if (normalizeCatalog(subject.catalog_number)) return 'exact'
  if (subject.artist && subject.title) return 'ambiguous'
  return 'unknown'
}

export function assembleAuctionDetailEvidence(input: {
  nowMs?: number
  principalId: string
  subject: AuctionSubjectInput
  primary: AuctionLotInput | null
  comparables?: AuctionLotInput[]
  authorized_scopes?: string[]
}) {
  const nowMs = input.nowMs ?? Date.now()
  const limitations: string[] = []
  const candidates: AssembledAuctionCandidate[] = []
  const seen = new Set<string>()

  const push = (c: AssembledAuctionCandidate | null) => {
    if (!c || seen.has(c.evidence_id)) return
    if (c.stale) limitations.push(`Stale evidence flagged: ${c.evidence_id}`)
    seen.add(c.evidence_id)
    candidates.push(c)
  }

  if (input.primary && isDeleted(input.primary)) {
    limitations.push('Primary auction is deleted and excluded from candidates.')
  }

  const primaryCandidate =
    input.primary && !isDeleted(input.primary)
      ? mapLotToCandidate(input.subject, input.primary, {
          nowMs,
          authorization_scope: 'authenticated_market',
        })
      : null
  push(primaryCandidate)

  for (const row of input.comparables || []) {
    if (isDeleted(row)) {
      limitations.push(`Deleted comparable excluded: ${row.lot_id || row.listing_id || 'unknown'}`)
      continue
    }
    push(
      mapLotToCandidate(input.subject, row, {
        nowMs,
        authorization_scope: 'authenticated_market',
      }),
    )
  }

  const confidence = pressingConfidence(input.subject)
  if (confidence === 'ambiguous') {
    limitations.push('Exact pressing identity is ambiguous (no catalog number).')
  } else if (confidence === 'unknown') {
    limitations.push('Exact pressing identity unknown; auction guidance may abstain.')
  }

  if (!primaryCandidate && (!input.primary || isDeleted(input.primary))) {
    limitations.push('No usable auction evidence for this lot.')
  }

  const asking_count = candidates.filter((c) => c.sale_kind === 'asking').length
  const sold_or_completed_count = candidates.filter(
    (c) => c.sale_kind === 'sold' || c.sale_kind === 'completed',
  ).length

  const auction = toLotPayload(input.primary, primaryCandidate, nowMs)
  const comparable_auctions = candidates
    .filter((c) => c.lot_id !== auction.lot_id)
    .slice(0, 10)
    .map((c) => ({
      lot_id: c.lot_id,
      release_id: c.release_id,
      pressing_id: c.pressing_id,
      current_price: c.current_price,
      sale_kind: c.sale_kind,
    }))

  return {
    assembler_version: AUCTION_EVIDENCE_ASSEMBLER_VERSION,
    analysis_mode: 'single_auction' as const,
    requesting_principal_fixture: input.principalId,
    principal_id: input.principalId,
    authorized_scopes: input.authorized_scopes || ['authenticated_market'],
    subject: {
      lot_id: input.subject.lot_id || auction.lot_id,
      listing_id: input.subject.listing_id || auction.listing_id,
      artist: input.subject.artist || null,
      title: input.subject.title || null,
      catalog_number: input.subject.catalog_number || null,
      release_id: input.subject.release_id || auction.release_id,
      pressing_id: input.subject.pressing_id || auction.pressing_id,
      pressing_identity_confidence: confidence,
    },
    auction,
    candidates,
    comparable_auctions,
    asking_count,
    sold_or_completed_count,
    auction_count: primaryCandidate && !primaryCandidate.stale ? 1 : 0,
    limitations,
    request_bidder_identity: false,
    claim_collusion: false,
    claim_shill_bidding: false,
  }
}

function endingConcentration(lots: AssembledAuctionLotPayload[]) {
  const buckets = new Map<string, number>()
  for (const lot of lots) {
    if (!lot.end_at) continue
    const bucket = String(lot.end_at).slice(0, 13)
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
  }
  return [...buckets.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count)
}

export function assembleWatchlistTemperatureEvidence(input: {
  nowMs?: number
  principalId: string
  watchlistOwnerPrincipalId: string
  lots: AuctionLotInput[]
  maxLots?: number
  authorized_scopes?: string[]
}) {
  const nowMs = input.nowMs ?? Date.now()
  const maxLots = input.maxLots ?? DEFAULT_MAX_LOTS
  const limitations: string[] = []
  const unauthorized =
    !input.principalId ||
    !input.watchlistOwnerPrincipalId ||
    input.principalId !== input.watchlistOwnerPrincipalId

  if (unauthorized) {
    limitations.push('Unauthorized watchlist — owner principal does not match requester.')
    return {
      assembler_version: AUCTION_EVIDENCE_ASSEMBLER_VERSION,
      analysis_mode: 'watchlist_batch' as const,
      requesting_principal_fixture: input.principalId,
      principal_id: input.principalId,
      watchlist_owner_principal_fixture: input.watchlistOwnerPrincipalId,
      unauthorized_watchlist: true,
      authorized_scopes: input.authorized_scopes || ['owner_watchlist', 'authenticated_market'],
      watchlist_auctions: [] as AssembledAuctionLotPayload[],
      candidates: [] as AssembledAuctionCandidate[],
      asking_count: 0,
      sold_or_completed_count: 0,
      ending_concentration: [] as Array<{ bucket: string; count: number }>,
      underpriced_candidates: [] as AssembledAuctionLotPayload[],
      overheated_candidates: [] as AssembledAuctionLotPayload[],
      limitations,
      request_bidder_identity: false,
      claim_collusion: false,
      claim_shill_bidding: false,
    }
  }

  const subject: AuctionSubjectInput = {}
  const candidates: AssembledAuctionCandidate[] = []
  const payloads: AssembledAuctionLotPayload[] = []
  const seen = new Set<string>()
  let truncated = false

  for (const lot of input.lots) {
    if (isDeleted(lot)) {
      limitations.push(`Deleted watchlist auction excluded: ${lot.lot_id || lot.listing_id || 'unknown'}`)
      continue
    }
    const candidate = mapLotToCandidate(subject, { ...lot, authorized: lot.authorized !== false }, {
      nowMs,
      authorization_scope: 'owner_watchlist',
    })
    if (!candidate) continue
    if (candidate.stale) {
      limitations.push(`Stale watchlist auction flagged: ${candidate.lot_id}`)
    }
    if (seen.has(candidate.lot_id)) continue
    if (payloads.length >= maxLots) {
      truncated = true
      continue
    }
    seen.add(candidate.lot_id)
    candidates.push(candidate)
    payloads.push(toLotPayload(lot, candidate, nowMs))
  }

  if (truncated) {
    limitations.push(`Watchlist batch bounded to ${maxLots} auctions (cap applied).`)
  }
  if (payloads.length === 0) {
    limitations.push('No usable watchlist auction evidence after exclusions.')
  }

  const asking = payloads.filter((p) => {
    const st = String(p.auction_state || '').toLowerCase()
    return st === 'active' || st === 'asking' || (!st.includes('end') && !st.includes('sold'))
  })
  const soldOrCompleted = payloads.filter((p) => {
    const st = String(p.auction_state || '').toLowerCase()
    return st.includes('end') || st.includes('sold') || st.includes('completed') || st.includes('closed')
  })

  // Price/activity proxies only — never labeled as collusion/shill/manipulation.
  const priced = payloads.filter((p) => p.current_price != null && Number.isFinite(p.current_price))
  const avgPrice =
    priced.length > 0
      ? priced.reduce((sum, p) => sum + Number(p.current_price), 0) / priced.length
      : null

  const underpriced_candidates = payloads
    .filter(
      (p) =>
        p.current_price != null &&
        avgPrice != null &&
        p.current_price < avgPrice * 0.7 &&
        p.bid_count <= 2 &&
        !p.stale,
    )
    .slice(0, 5)

  const overheated_candidates = payloads
    .filter((p) => (p.late_bid_pressure >= 0.7 || p.bid_velocity >= 3) && !p.stale)
    .slice(0, 5)

  return {
    assembler_version: AUCTION_EVIDENCE_ASSEMBLER_VERSION,
    analysis_mode: 'watchlist_batch' as const,
    requesting_principal_fixture: input.principalId,
    principal_id: input.principalId,
    watchlist_owner_principal_fixture: input.watchlistOwnerPrincipalId,
    unauthorized_watchlist: false,
    authorized_scopes: input.authorized_scopes || ['owner_watchlist', 'authenticated_market'],
    watchlist_auctions: payloads,
    candidates,
    asking_count: asking.length || candidates.filter((c) => c.sale_kind === 'asking').length,
    sold_or_completed_count:
      soldOrCompleted.length ||
      candidates.filter((c) => c.sale_kind === 'sold' || c.sale_kind === 'completed').length,
    ending_concentration: endingConcentration(payloads),
    underpriced_candidates,
    overheated_candidates,
    limitations,
    request_bidder_identity: false,
    claim_collusion: false,
    claim_shill_bidding: false,
  }
}
