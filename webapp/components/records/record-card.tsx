'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  formatDate,
  formatMoneyCents,
  gradeSummary,
  purchaseTypeLabel,
  recordSubtitle,
} from '@/lib/records-format'
import type { CollectionRecord } from '@/lib/records-types'

import { RecordThumbnail } from './record-thumbnail'

type Props = {
  record: CollectionRecord
  compact?: boolean
}

export function RecordCard({ record, compact }: Props) {
  const grades = gradeSummary(record)

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:border-brand/40 hover:shadow-md dark:border-white/10 dark:bg-slate-950">
      <Link href={`/records/${record.id}`} className="flex flex-1 flex-col p-4">
        <div className="flex gap-3">
          <RecordThumbnail record={record} size={compact ? 'sm' : 'md'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {record.artist}
            </p>
            <h3 className="line-clamp-2 font-semibold text-slate-900 dark:text-white">
              {record.name}
            </h3>
            <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
              {recordSubtitle(record)}
            </p>
          </div>
        </div>

        {!compact && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {record.purchaseType && (
              <Badge variant="primary">{purchaseTypeLabel(record.purchaseType)}</Badge>
            )}
            {grades && <Badge variant="outline">{grades}</Badge>}
            {record.isPromo && <Badge variant="warning">Promo</Badge>}
            <Badge variant="outline">Not listed</Badge>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <div>
            <dt className="text-slate-400">Purchased</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">
              {formatDate(record.purchasedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Paid</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">
              {formatMoneyCents(record.purchasePriceCents, record.purchaseCurrency ?? 'USD')}
            </dd>
          </div>
        </dl>
      </Link>

      <div className="flex border-t border-slate-100 px-2 py-2 dark:border-white/5">
        <Button variant="ghost" size="sm" className="flex-1" asChild>
          <Link href={`/records/${record.id}`}>View</Link>
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" asChild>
          <Link href={`/records/${record.id}/edit`}>Edit</Link>
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" asChild>
          <Link href={`/market?record=${record.id}`}>List</Link>
        </Button>
      </div>
    </article>
  )
}
