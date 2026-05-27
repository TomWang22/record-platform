'use client'

import type { CollectionRecord } from '@/lib/records-types'
import { cn } from '@/lib/utils'

type Props = {
  record: CollectionRecord
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass = {
  sm: 'h-12 w-12 text-lg',
  md: 'h-20 w-20 text-2xl',
  lg: 'h-32 w-32 text-4xl',
}

export function RecordThumbnail({ record, size = 'md', className }: Props) {
  const mediaUrl = record.mediaPieces?.find((m) => m.urlOrPath)?.urlOrPath
  if (mediaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl}
        alt=""
        className={cn(
          'shrink-0 rounded-lg border border-slate-200/80 object-cover dark:border-white/10',
          sizeClass[size],
          className,
        )}
      />
    )
  }

  const initial = (record.artist?.trim()?.[0] ?? '?').toUpperCase()
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-gradient-to-br from-slate-100 to-slate-200 font-semibold text-slate-600 dark:border-white/10 dark:from-slate-800 dark:to-slate-900 dark:text-slate-300',
        sizeClass[size],
        className,
      )}
      aria-hidden
    >
      {initial}
    </div>
  )
}
