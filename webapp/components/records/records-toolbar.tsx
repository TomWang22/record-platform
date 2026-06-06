'use client'

import { Button } from '@/components/ui/button'
import {
  RECORDS_PAGE_SIZES,
  type ListedStatusFilter,
  type PurchaseTypeFilter,
  type RecordsSortKey,
  type RecordsViewMode,
} from '@/lib/records-types'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  onSearch: () => void
  onClear?: () => void
  loading?: boolean
  sortKey: RecordsSortKey
  onSortChange: (key: RecordsSortKey) => void
  pageSize: number
  onPageSizeChange: (n: number) => void
  viewMode: RecordsViewMode
  onViewModeChange: (mode: RecordsViewMode) => void
  totalCount: number
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  purchaseTypeFilter?: PurchaseTypeFilter
  onPurchaseTypeFilterChange?: (v: PurchaseTypeFilter) => void
  purchasedFrom?: string
  purchasedTo?: string
  onPurchasedFromChange?: (v: string) => void
  onPurchasedToChange?: (v: string) => void
  receivedFrom?: string
  receivedTo?: string
  onReceivedFromChange?: (v: string) => void
  onReceivedToChange?: (v: string) => void
  listedFilter?: ListedStatusFilter
  onListedFilterChange?: (v: ListedStatusFilter) => void
}

export function RecordsToolbar({
  query,
  onQueryChange,
  onSearch,
  onClear,
  loading,
  sortKey,
  onSortChange,
  pageSize,
  onPageSizeChange,
  viewMode,
  onViewModeChange,
  totalCount,
  page,
  pageCount,
  onPageChange,
  purchaseTypeFilter = '',
  onPurchaseTypeFilterChange,
  purchasedFrom = '',
  purchasedTo = '',
  onPurchasedFromChange,
  onPurchasedToChange,
  receivedFrom = '',
  receivedTo = '',
  onReceivedFromChange,
  onReceivedToChange,
  listedFilter = '',
  onListedFilterChange,
}: Props) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-slate-950"
      data-testid="records-filter-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="records-search-input"
          placeholder="Search artist, album, catalog, label…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
          className="min-w-[200px] flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-white"
        />
        <Button onClick={onSearch} disabled={loading}>
          {loading ? 'Loading…' : 'Search'}
        </Button>
        <Button variant="ghost" onClick={() => onClear?.()} disabled={loading || !query}>
          Clear
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-white/5">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Purchase type
          <select
            data-testid="records-filter-purchase-type"
            value={purchaseTypeFilter}
            onChange={(e) =>
              onPurchaseTypeFilterChange?.(e.target.value as PurchaseTypeFilter)
            }
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          >
            <option value="">All types</option>
            <option value="fixed_price">Fixed price</option>
            <option value="auction_win">Auction win</option>
            <option value="retail">Retail</option>
            <option value="trade">Trade</option>
            <option value="gift">Gift</option>
            <option value="obo">OBO</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Purchased from
          <input
            type="date"
            data-testid="records-filter-purchased-from"
            value={purchasedFrom}
            onChange={(e) => onPurchasedFromChange?.(e.target.value)}
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Purchased to
          <input
            type="date"
            data-testid="records-filter-purchased-to"
            value={purchasedTo}
            onChange={(e) => onPurchasedToChange?.(e.target.value)}
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Received from
          <input
            type="date"
            data-testid="records-filter-received-from"
            value={receivedFrom}
            onChange={(e) => onReceivedFromChange?.(e.target.value)}
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Received to
          <input
            type="date"
            data-testid="records-filter-received-to"
            value={receivedTo}
            onChange={(e) => onReceivedToChange?.(e.target.value)}
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Listed
          <select
            data-testid="records-filter-listed"
            value={listedFilter}
            onChange={(e) =>
              onListedFilterChange?.(e.target.value as ListedStatusFilter)
            }
            className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
          >
            <option value="">All</option>
            <option value="listed">Listed</option>
            <option value="not_listed">Not listed</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-sm text-slate-500 dark:text-slate-400"
          data-testid="records-count"
        >
          {loading ? 'Loading records…' : `${totalCount} record${totalCount === 1 ? '' : 's'}`}
          {!loading && pageCount > 1 ? ` · page ${page} of ${pageCount}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Sort
            <select
              value={sortKey}
              onChange={(e) => onSortChange(e.target.value as RecordsSortKey)}
              className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
            >
              <option value="artist_asc">Artist A–Z</option>
              <option value="artist_desc">Artist Z–A</option>
              <option value="title_asc">Title A–Z</option>
              <option value="title_desc">Title Z–A</option>
              <option value="purchased_desc">Purchased (newest)</option>
              <option value="purchased_asc">Purchased (oldest)</option>
              <option value="price_desc">Price (high)</option>
              <option value="price_asc">Price (low)</option>
              <option value="added_desc">Recently added</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Per page
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900"
            >
              {RECORDS_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div className="flex rounded-lg border border-slate-200/80 p-0.5 dark:border-white/10">
            {(['grid', 'list', 'compact'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`records-view-${mode}`}
                onClick={() => onViewModeChange(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  viewMode === mode
                    ? 'bg-brand text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
