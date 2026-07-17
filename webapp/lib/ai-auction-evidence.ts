/**
 * Phase 34B — fetch live authorized auction rows and assemble intelligence payloads.
 */
import {
  assembleAuctionDetailEvidence,
  assembleWatchlistTemperatureEvidence,
  type AuctionLotInput,
} from './ai-auction-evidence-assembler'
import {
  fetchAuctionBids,
  fetchAuctionState,
  listingIsAuction,
  type AuctionBidItem,
  type AuctionState,
} from './auctions-api'
import { fetchListing, fetchMyListings, searchListings } from './listings-api'
import type { MarketplaceListing } from './listings-types'
import { fetchWatchlistFromApi } from './marketplace-shopping-api'
import type { StoredListingRef } from './local-marketplace-storage'

function centsToDollars(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null
  return Math.round(cents) / 100
}

function parsePriceDisplay(display: string | null | undefined): number | null {
  if (!display) return null
  const cleaned = display.replace(/[^0-9.]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

function listingSaleKind(listing: MarketplaceListing): AuctionLotInput['sale_kind'] {
  const st = String(listing.status ?? listing.listing_status ?? '').toLowerCase()
  if (st === 'sold') return 'sold'
  if (st === 'closed' || st === 'archived' || st === 'ended') return 'completed'
  return 'asking'
}

function listingToLotInput(
  listing: MarketplaceListing,
  state?: AuctionState | null,
  bids?: AuctionBidItem[],
): AuctionLotInput {
  const price =
    state != null
      ? centsToDollars(state.currentBidCents) ?? parsePriceDisplay(state.currentBidDisplay)
      : listing.price != null
        ? Number(listing.price)
        : centsToDollars(listing.currentBidCents) ?? parsePriceDisplay(listing.currentBidDisplay)

  const endAt = listing.auction?.endsAt || listing.endsAt || null
  const timeLeftMs =
    state?.timeLeftMs != null
      ? state.timeLeftMs
      : endAt
        ? Math.max(0, Date.parse(endAt) - Date.now())
        : null

  return {
    lot_id: listing.id,
    listing_id: listing.id,
    title: listing.title,
    artist: listing.artist,
    catalog_number: listing.catalogNumber ?? listing.catalog_number ?? null,
    current_price: price,
    currency: listing.currency || 'USD',
    bid_count: state?.bidCount ?? listing.bidCount ?? bids?.length ?? 0,
    bid_timestamps: (bids || []).map((b) => b.createdAtDisplay).filter(Boolean),
    end_at: endAt,
    time_left_ms: timeLeftMs,
    auction_state: state?.status || (listingSaleKind(listing) === 'asking' ? 'active' : 'ended'),
    deletion_state: String(listing.status ?? '').toLowerCase() === 'deleted' ? 'DELETED' : 'ACTIVE',
    observed_at: listing.updated_at || listing.listed_at || listing.created_at || null,
    release_id:
      listing.artist && listing.title
        ? `release:${listing.artist.trim()}:${listing.title.trim()}`
        : null,
    pressing_id: listing.catalogNumber || listing.catalog_number
      ? `pressing:cat:${String(listing.catalogNumber ?? listing.catalog_number)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')}`
      : null,
    authorized: true,
    sale_kind: listingSaleKind(listing),
    // Intentionally not mapping highBidderMasked / winnerMasked into assembler input fields
    // that would survive into payloads — assembler strips them if present.
  }
}

async function loadAuctionLot(listingId: string): Promise<{
  listing: MarketplaceListing | null
  lot: AuctionLotInput | null
}> {
  try {
    const listing = await fetchListing(listingId, true)
    if (!listingIsAuction(listing)) {
      return { listing, lot: null }
    }
    let state: AuctionState | null = null
    let bids: AuctionBidItem[] = []
    try {
      const [s, b] = await Promise.all([
        fetchAuctionState(listingId),
        fetchAuctionBids(listingId),
      ])
      state = s
      bids = b.items ?? []
    } catch {
      // State/bids may be unavailable for ended listings; listing metadata still usable.
    }
    return { listing, lot: listingToLotInput(listing, state, bids) }
  } catch {
    return { listing: null, lot: null }
  }
}

async function loadComparableLots(
  listing: MarketplaceListing,
  excludeId: string,
): Promise<AuctionLotInput[]> {
  const q = [listing.artist, listing.title].filter(Boolean).join(' ').trim()
  if (!q) return []
  try {
    const search = await searchListings({ q, limit: 20, sort_by: 'newly_listed' })
    const auctions = (search.listings || []).filter(
      (row) => row.id !== excludeId && listingIsAuction(row),
    )
    return auctions.slice(0, 8).map((row) => listingToLotInput(row))
  } catch {
    return []
  }
}

export async function gatherLiveAuctionDetailEvidence(input: {
  listingId: string
  principalId: string
}) {
  const { listing, lot } = await loadAuctionLot(input.listingId)
  const comparables = listing ? await loadComparableLots(listing, input.listingId) : []

  return assembleAuctionDetailEvidence({
    principalId: input.principalId,
    subject: {
      lot_id: input.listingId,
      listing_id: input.listingId,
      artist: listing?.artist || null,
      title: listing?.title || null,
      catalog_number: listing?.catalogNumber ?? listing?.catalog_number ?? null,
      release_id: lot?.release_id || null,
      pressing_id: lot?.pressing_id || null,
    },
    primary: lot,
    comparables,
    authorized_scopes: ['authenticated_market'],
  })
}

function refLooksLikeAuction(ref: StoredListingRef): boolean {
  const sale = String(ref.saleTypeDisplay || ref.saleType || '').toLowerCase()
  return sale.includes('auction')
}

export async function gatherLiveWatchlistTemperatureEvidence(input: {
  principalId: string
}) {
  const rows = await fetchWatchlistFromApi()
  const auctionRefs = rows.filter(refLooksLikeAuction)
  const lots: AuctionLotInput[] = []

  // Bound concurrent enrichment; assembler also caps final batch size.
  const slice = auctionRefs.slice(0, 30)
  await Promise.all(
    slice.map(async (ref) => {
      const { lot } = await loadAuctionLot(ref.id)
      if (lot) {
        lots.push(lot)
        return
      }
      // Fallback metadata-only row when auction state is unavailable.
      lots.push({
        lot_id: ref.id,
        listing_id: ref.id,
        title: ref.title,
        artist: ref.artist || null,
        current_price: parsePriceDisplay(ref.priceDisplay ?? null),
        currency: 'USD',
        bid_count: 0,
        auction_state: 'active',
        deletion_state: 'ACTIVE',
        observed_at: ref.viewedAt || null,
        authorized: true,
        sale_kind: 'asking',
      })
    }),
  )

  return assembleWatchlistTemperatureEvidence({
    principalId: input.principalId,
    watchlistOwnerPrincipalId: input.principalId,
    lots,
    maxLots: 25,
    authorized_scopes: ['owner_watchlist', 'authenticated_market'],
  })
}

export async function gatherLiveSellerAuctionTemperatureEvidence(input: {
  principalId: string
}) {
  const mine = await fetchMyListings().catch(() => [] as MarketplaceListing[])
  const auctions = mine.filter((l) => listingIsAuction(l))
  const lots: AuctionLotInput[] = []

  for (const listing of auctions.slice(0, 30)) {
    const { lot } = await loadAuctionLot(listing.id)
    lots.push(lot || listingToLotInput(listing))
  }

  return assembleWatchlistTemperatureEvidence({
    principalId: input.principalId,
    watchlistOwnerPrincipalId: input.principalId,
    lots,
    maxLots: 25,
    authorized_scopes: ['owner_private', 'authenticated_market', 'owner_watchlist'],
  })
}
