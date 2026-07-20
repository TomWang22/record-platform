/**
 * Phase 34B — fetch live authorized market rows and assemble scarcity/valuation candidates.
 */
import { apiFetch } from './api-client'
import {
  assembleScarcityEvidence,
  assembleValuationEvidence,
  type CompletedSaleEventInput,
  type ListingEvidenceInput,
  type RecordSubjectInput,
  type ScarcityAssemblyResult,
} from './ai-market-evidence-assembler'
import { searchListings, fetchMyListings } from './listings-api'
import type { CollectionRecord } from './records-types'
import type { MarketplaceListing } from './listings-types'
import { parseRpFieldsFromRow } from './rp-listing-fields'

function listingToEvidenceInput(listing: MarketplaceListing): ListingEvidenceInput {
  const row = listing as MarketplaceListing & {
    amenities?: unknown
    source_record_id?: string | null
    deleted_at?: string | null
    pressingYear?: number | string | null
  }
  const rp = parseRpFieldsFromRow(listing as unknown as Record<string, unknown>)
  return {
    id: listing.id,
    title: listing.title,
    artist: listing.artist,
    catalogNumber: listing.catalogNumber ?? listing.catalog_number ?? rp.catalogNumber,
    label: listing.label ?? rp.label,
    format: listing.format,
    price: listing.price,
    currency: listing.currency || 'USD',
    status: listing.status ?? listing.listing_status,
    mediaCondition: listing.mediaCondition ?? listing.grade ?? rp.mediaCondition,
    sold_at: listing.sold_at,
    created_at: listing.created_at,
    updated_at: listing.updated_at,
    listed_at: listing.listed_at,
    source_record_id: row.source_record_id ?? null,
    deleted_at: row.deleted_at ?? null,
    pressingYear: row.pressingYear ?? null,
    amenities: row.amenities,
  }
}

export function collectionRecordToSubject(record: CollectionRecord): RecordSubjectInput {
  return {
    id: record.id,
    artist: record.artist,
    name: record.name,
    format: record.format,
    catalogNumber: record.catalogNumber,
    label: record.label,
    releaseYear: record.releaseYear,
    pressingYear: record.pressingYear,
    recordGrade: record.recordGrade,
  }
}

async function fetchAuctionResultsSafe(query: string): Promise<
  Array<{
    id?: string
    title?: string
    price?: number
    total_cost?: number
    currency?: string
    sold_at?: string
    created_at?: string
  }>
> {
  try {
    const data = await apiFetch<{ results?: Array<Record<string, unknown>> }>(
      `/api/auctions/results?q=${encodeURIComponent(query)}&limit=40`,
      { auth: true },
    )
    return (data.results || []).map((row, i) => ({
      id: row.id != null ? String(row.id) : `row-${i}`,
      title: row.title != null ? String(row.title) : undefined,
      price: row.price != null ? Number(row.price) : undefined,
      total_cost: row.total_cost != null ? Number(row.total_cost) : undefined,
      currency: row.currency != null ? String(row.currency) : 'USD',
      sold_at: row.sold_at != null ? String(row.sold_at) : undefined,
      created_at: row.created_at != null ? String(row.created_at) : undefined,
    }))
  } catch {
    return []
  }
}

/**
 * Load authorized COMPLETED_SALE seed events for owner-proof sold floors.
 * Distinct from listings — never invents sales from archived inventory.
 */
async function fetchCompletedSaleEventsSafe(
  record: CollectionRecord,
): Promise<CompletedSaleEventInput[]> {
  try {
    const qs = new URLSearchParams()
    const qPrimary = [record.artist, record.name].filter(Boolean).join(' ').trim()
    if (qPrimary) qs.set('q', qPrimary)
    if (record.artist) qs.set('artist', record.artist)
    if (record.catalogNumber) qs.set('catalog', record.catalogNumber)
    const data = await apiFetch<{ events?: CompletedSaleEventInput[] }>(
      `/api/marketplace/completed-sales?${qs.toString()}`,
      { auth: true },
    )
    return Array.isArray(data.events) ? data.events : []
  } catch {
    return []
  }
}

async function loadLiveEvidenceInputs(record: CollectionRecord) {
  const subject = collectionRecordToSubject(record)
  const qPrimary = [record.artist, record.name].filter(Boolean).join(' ').trim()
  const qCatalog = record.catalogNumber?.trim() || ''

  const [searchPrimary, searchCatalog, mine, auctions, completedSaleEvents] = await Promise.all([
    qPrimary
      ? searchListings({ q: qPrimary, limit: 40, sort_by: 'newly_listed' }).catch(() => ({
          listings: [] as MarketplaceListing[],
        }))
      : Promise.resolve({ listings: [] as MarketplaceListing[] }),
    qCatalog
      ? searchListings({ q: qCatalog, limit: 20, sort_by: 'newly_listed' }).catch(() => ({
          listings: [] as MarketplaceListing[],
        }))
      : Promise.resolve({ listings: [] as MarketplaceListing[] }),
    fetchMyListings().catch(() => [] as MarketplaceListing[]),
    fetchAuctionResultsSafe(qPrimary),
    fetchCompletedSaleEventsSafe(record),
  ])

  const byId = new Map<string, MarketplaceListing>()
  for (const l of [...searchPrimary.listings, ...searchCatalog.listings]) {
    if (l.id) byId.set(l.id, l)
  }

  return {
    record: subject,
    activeListings: [...byId.values()].map(listingToEvidenceInput),
    ownerListings: mine.map(listingToEvidenceInput),
    auctionResults: auctions,
    completedSaleEvents,
  }
}

export async function gatherLiveMarketEvidenceForRecord(
  record: CollectionRecord,
): Promise<ScarcityAssemblyResult> {
  return assembleScarcityEvidence(await loadLiveEvidenceInputs(record))
}

export async function gatherLiveValuationEvidenceForRecord(record: CollectionRecord) {
  return assembleValuationEvidence(await loadLiveEvidenceInputs(record))
}
