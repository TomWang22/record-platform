/** Collection record shape from GET /api/records and GET /api/records/:id */

export type RecordMediaPiece = {
  id: string
  kind: string
  index: number
  grade?: string | null
  urlOrPath?: string | null
}

export type CollectionRecord = {
  id: string
  userId?: string
  artist: string
  name: string
  format: string
  catalogNumber?: string | null
  recordGrade?: string | null
  sleeveGrade?: string | null
  label?: string | null
  labelCode?: string | null
  releaseYear?: number | null
  releaseDate?: string | null
  pressingYear?: number | null
  hasInsert?: boolean
  hasBooklet?: boolean
  hasObiStrip?: boolean
  hasFactorySleeve?: boolean
  isPromo?: boolean
  notes?: string | null
  purchasedAt?: string | null
  receivedAt?: string | null
  purchaseType?: string | null
  purchaseSource?: string | null
  sellerName?: string | null
  orderReference?: string | null
  purchasePriceCents?: number | null
  shippingPaidCents?: number | null
  taxesFeesPaidCents?: number | null
  purchaseCurrency?: string | null
  purchaseNotes?: string | null
  pricePaid?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  mediaPieces?: RecordMediaPiece[]
}

export type RecordRevision = {
  id: string
  recordId: string
  userId: string
  revisionNumber: number
  changedFields: string[] | unknown
  previousValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  createdBy: string
  createdAt: string
}

export type RecordsViewMode = 'grid' | 'list' | 'compact'

export type RecordsSortKey =
  | 'artist_asc'
  | 'artist_desc'
  | 'title_asc'
  | 'title_desc'
  | 'purchased_desc'
  | 'purchased_asc'
  | 'price_desc'
  | 'price_asc'
  | 'added_desc'

export const RECORDS_PAGE_SIZES = [24, 48, 72, 120] as const

export type ListingLinkStatus = 'not_listed' | 'draft' | 'published' | 'sold'
