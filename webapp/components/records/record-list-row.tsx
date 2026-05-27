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

export function RecordListRow({ record, compact }: Props) {
  const grades = gradeSummary(record)

  return (
    <tr className="group border-b border-slate-100 last:border-0 hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.02]">
      <td className="py-3 pl-2 pr-3">
        <Link href={`/records/${record.id}`} className="flex items-center gap-3">
          <RecordThumbnail record={record} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-white">
              <span className="text-slate-500 dark:text-slate-400">{record.artist}</span>
              {' — '}
              {record.name}
            </p>
            <p className="truncate text-sm text-slate-500">{recordSubtitle(record)}</p>
          </div>
        </Link>
      </td>
      {!compact && (
        <>
          <td className="hidden px-2 py-3 text-sm text-slate-600 dark:text-slate-300 md:table-cell">
            {record.label ?? '—'}
          </td>
          <td className="hidden px-2 py-3 text-sm text-slate-600 dark:text-slate-300 lg:table-cell">
            {record.catalogNumber ?? '—'}
          </td>
        </>
      )}
      <td className="hidden px-2 py-3 text-sm sm:table-cell">{grades ?? '—'}</td>
      <td className="hidden px-2 py-3 text-sm md:table-cell">
        {record.purchaseType ? (
          <Badge variant="primary" className="whitespace-nowrap">
            {purchaseTypeLabel(record.purchaseType)}
          </Badge>
        ) : (
          '—'
        )}
      </td>
      <td className="hidden px-2 py-3 text-sm text-slate-600 dark:text-slate-300 lg:table-cell">
        {formatMoneyCents(record.purchasePriceCents, record.purchaseCurrency ?? 'USD')}
      </td>
      <td className="hidden px-2 py-3 text-sm text-slate-600 dark:text-slate-300 xl:table-cell">
        {formatDate(record.purchasedAt)}
      </td>
      <td className="hidden px-2 py-3 text-sm text-slate-600 dark:text-slate-300 xl:table-cell">
        {formatDate(record.receivedAt)}
      </td>
      <td className="py-3 pr-2 text-right">
        <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/records/${record.id}`}>View</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/records/${record.id}/edit`}>Edit</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/records/${record.id}/revisions`}>History</Link>
          </Button>
        </div>
      </td>
    </tr>
  )
}
