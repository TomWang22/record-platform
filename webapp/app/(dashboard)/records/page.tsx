'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { RecordCard } from '@/components/records/record-card'
import { RecordListRow } from '@/components/records/record-list-row'
import { RecordsToolbar } from '@/components/records/records-toolbar'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { fetchListedRecordLinks } from '@/lib/records-listing-link'
import { sortRecords } from '@/lib/records-sort'
import type {
  CollectionRecord,
  ListedStatusFilter,
  PurchaseTypeFilter,
  RecordsSortKey,
  RecordsViewMode,
} from '@/lib/records-types'
import { normalizeCollectionRecord } from '@/lib/records-types'
import { RECORDS_PAGE_SIZES } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

const VIEW_STORAGE_KEY = 'rp-records-view'
const SORT_STORAGE_KEY = 'rp-records-sort'
const PAGE_SIZE_STORAGE_KEY = 'rp-records-page-size'

export default function RecordsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading collection…</p>}>
      <RecordsPageContent />
    </Suspense>
  )
}

function parseViewMode(raw: string | null): RecordsViewMode {
  if (raw === 'grid' || raw === 'list' || raw === 'compact') return raw
  return 'grid'
}

function parseIsoDay(iso?: string | null): string | null {
  if (!iso) return null
  const d = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

function dayInRange(day: string | null, from: string, to: string): boolean {
  if (!day) return false
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

function RecordsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { authRequired, onApiError } = useRequireAuth()
  const [records, setRecords] = useState<CollectionRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<RecordsViewMode>(() =>
    parseViewMode(searchParams.get('view')),
  )
  const [sortKey, setSortKey] = useState<RecordsSortKey>('artist_asc')
  const [pageSize, setPageSize] = useState<number>(RECORDS_PAGE_SIZES[0])
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<PurchaseTypeFilter>('')
  const [listedFilter, setListedFilter] = useState<ListedStatusFilter>('')
  const [purchasedFrom, setPurchasedFrom] = useState('')
  const [purchasedTo, setPurchasedTo] = useState('')
  const [receivedFrom, setReceivedFrom] = useState('')
  const [receivedTo, setReceivedTo] = useState('')
  const [listedLinks, setListedLinks] = useState(
    () => new Map<string, { listingId: string; status: NonNullable<CollectionRecord['listingStatus']> }>(),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const urlView = searchParams.get('view') as RecordsViewMode | null
    if (urlView === 'grid' || urlView === 'list' || urlView === 'compact') {
      setViewMode(urlView)
      return
    }
    const v = localStorage.getItem(VIEW_STORAGE_KEY) as RecordsViewMode | null
    if (v === 'grid' || v === 'list' || v === 'compact') setViewMode(v)
    const s = localStorage.getItem(SORT_STORAGE_KEY) as RecordsSortKey | null
    if (s) setSortKey(s)
    const ps = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY))
    if (RECORDS_PAGE_SIZES.includes(ps as (typeof RECORDS_PAGE_SIZES)[number])) {
      setPageSize(ps)
    }
  }, [searchParams])

  const fetchRecords = useCallback(
    async (nextQuery = query) => {
      setLoading(true)
      setError(null)
      try {
        const params = nextQuery ? `?${new URLSearchParams({ q: nextQuery })}` : ''
        const data = await apiFetch<CollectionRecord[]>(`/api/records${params}`, {
          auth: true,
        })
        const links = await fetchListedRecordLinks().catch(() => new Map())
        setListedLinks(links)
        setRecords(
          data.map((r) => {
            const link = links.get(r.id)
            return normalizeCollectionRecord({
              ...r,
              listingId: link?.listingId ?? null,
              listingStatus: link ? link.status : 'not_listed',
            })
          }),
        )
        setPage(1)
      } catch (err) {
        if (onApiError(err)) return
        setError(err)
      } finally {
        setLoading(false)
        setHasLoaded(true)
      }
    },
    [query, onApiError],
  )

  useEffect(() => {
    if (!authRequired) void fetchRecords()
  }, [authRequired, fetchRecords])

  const filtered = useMemo(() => {
    let rows = records
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) => {
        const hay = `${r.artist ?? ''} ${r.name ?? ''} ${r.catalogNumber ?? ''} ${r.label ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    if (purchaseTypeFilter) {
      rows = rows.filter((r) => {
        const pt = String(r.purchaseType ?? '').toLowerCase()
        if (purchaseTypeFilter === 'obo') {
          return pt === 'obo' || pt === 'negotiated_obo'
        }
        return pt === purchaseTypeFilter
      })
    }
    if (purchasedFrom || purchasedTo) {
      rows = rows.filter((r) => dayInRange(parseIsoDay(r.purchasedAt), purchasedFrom, purchasedTo))
    }
    if (receivedFrom || receivedTo) {
      rows = rows.filter((r) => dayInRange(parseIsoDay(r.receivedAt), receivedFrom, receivedTo))
    }
    if (listedFilter === 'listed') {
      rows = rows.filter((r) => r.listingStatus && r.listingStatus !== 'not_listed')
    }
    if (listedFilter === 'not_listed') {
      rows = rows.filter((r) => !r.listingStatus || r.listingStatus === 'not_listed')
    }
    return rows
  }, [
    records,
    purchaseTypeFilter,
    purchasedFrom,
    purchasedTo,
    receivedFrom,
    receivedTo,
    listedFilter,
    query,
  ])

  const sorted = useMemo(
    () => sortRecords(filtered, sortKey),
    [filtered, sortKey],
  )

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const sliceStart = (safePage - 1) * pageSize
  const pageItems = sorted.slice(sliceStart, sliceStart + pageSize)

  function handleViewMode(mode: RecordsViewMode) {
    setViewMode(mode)
    localStorage.setItem(VIEW_STORAGE_KEY, mode)
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', mode)
    router.replace(`/records?${params.toString()}`, { scroll: false })
  }

  function handleSort(key: RecordsSortKey) {
    setSortKey(key)
    localStorage.setItem(SORT_STORAGE_KEY, key)
    setPage(1)
  }

  function handlePageSize(n: number) {
    setPageSize(n)
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(n))
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">My collection</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Catalog your vinyl and media — grid, list, or compact views with purchase history.
          </p>
        </div>
        <Button asChild>
          <Link href="/records/new">Add record</Link>
        </Button>
      </div>

      {authRequired && (
        <AuthRequiredCard
          title="Sign in to view your collection"
          description="Search and manage catalog records after signing in."
          returnTo="/records"
        />
      )}

      {!authRequired && (
        <>
          <RecordsToolbar
            query={query}
            onQueryChange={setQuery}
            onSearch={() => void fetchRecords()}
            onClear={() => {
              setQuery('')
              void fetchRecords('')
            }}
            loading={loading}
            sortKey={sortKey}
            onSortChange={handleSort}
            pageSize={pageSize}
            onPageSizeChange={handlePageSize}
            viewMode={viewMode}
            onViewModeChange={handleViewMode}
            totalCount={sorted.length}
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
            purchaseTypeFilter={purchaseTypeFilter}
            onPurchaseTypeFilterChange={(v) => {
              setPurchaseTypeFilter(v)
              setPage(1)
            }}
            purchasedFrom={purchasedFrom}
            purchasedTo={purchasedTo}
            onPurchasedFromChange={(v) => {
              setPurchasedFrom(v)
              setPage(1)
            }}
            onPurchasedToChange={(v) => {
              setPurchasedTo(v)
              setPage(1)
            }}
            receivedFrom={receivedFrom}
            receivedTo={receivedTo}
            onReceivedFromChange={(v) => {
              setReceivedFrom(v)
              setPage(1)
            }}
            onReceivedToChange={(v) => {
              setReceivedTo(v)
              setPage(1)
            }}
            listedFilter={listedFilter}
            onListedFilterChange={(v) => {
              setListedFilter(v)
              setPage(1)
            }}
          />

          {error && (
            <ApiErrorAlert
              title="Could not load records"
              error={error}
              onRetry={() => void fetchRecords()}
            />
          )}

          {hasLoaded && !loading && !error && (
            <div data-testid="records-ready" className="sr-only" aria-live="polite">
              Records loaded
            </div>
          )}

          {loading && (
            <div data-testid="records-loading" aria-busy="true">
            <div
              className={
                viewMode === 'grid'
                  ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                  : 'space-y-2'
              }
            >
              {Array.from({ length: Math.min(8, pageSize) }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
            </div>
          )}

          {hasLoaded && !loading && sorted.length === 0 && (
            <div
              data-testid="records-empty"
              className="rounded-2xl border border-dashed border-slate-300 p-12 text-center dark:border-white/15"
            >
              <p className="text-lg font-medium text-slate-800 dark:text-slate-200">No records yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Add your first pressing to start tracking purchase and grading details.
              </p>
              <Button className="mt-4" asChild>
                <Link href="/records/new">Add record</Link>
              </Button>
            </div>
          )}

          {hasLoaded && !loading && pageItems.length > 0 && viewMode === 'grid' && (
            <div
              data-testid="records-grid"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {pageItems.map((record) => (
                <RecordCard key={record.id} record={record} />
              ))}
            </div>
          )}

          {hasLoaded && !loading && pageItems.length > 0 && viewMode === 'compact' && (
            <div
              data-testid="records-compact"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {pageItems.map((record) => (
                <RecordCard key={record.id} record={record} compact />
              ))}
            </div>
          )}

          {hasLoaded && !loading && pageItems.length > 0 && viewMode === 'list' && (
            <div
              data-testid="records-list"
              className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-slate-950"
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-slate-900">
                    <th className="px-3 py-3">Release</th>
                    <th className="hidden px-2 py-3 md:table-cell">Label</th>
                    <th className="hidden px-2 py-3 lg:table-cell">Cat #</th>
                    <th className="hidden px-2 py-3 sm:table-cell">Grade</th>
                    <th className="hidden px-2 py-3 md:table-cell">Purchase</th>
                    <th className="hidden px-2 py-3 lg:table-cell">Price</th>
                    <th className="hidden px-2 py-3 xl:table-cell">Bought</th>
                    <th className="hidden px-2 py-3 xl:table-cell">Shipped</th>
                    <th className="hidden px-2 py-3 xl:table-cell">Delivered</th>
                    <th className="hidden px-2 py-3 2xl:table-cell">Listed</th>
                    <th className="px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((record) => (
                    <RecordListRow key={record.id} record={record} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
