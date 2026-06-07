'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

import { browseCardImageUrls } from '@/lib/listing-browse-display'
import type { MarketplaceListing } from '@/lib/listings-types'

type Props = {
  listing: MarketplaceListing
  compact?: boolean
  ended?: boolean
  href: string
}

export function ListingCardMedia({ listing, compact, ended, href }: Props) {
  const images = browseCardImageUrls(listing)
  const [index, setIndex] = useState(0)
  const active = images[index] ?? images[0]
  const hasMany = images.length > 1
  const frameClass = compact
    ? 'aspect-square min-h-[160px] max-h-[200px] w-full'
    : 'aspect-square min-h-[220px] w-full'

  const show = useCallback(
    (next: number) => {
      if (!hasMany) return
      setIndex((next + images.length) % images.length)
    },
    [hasMany, images.length],
  )

  return (
    <div
      className={`relative ${frameClass} shrink-0 overflow-hidden bg-slate-100 dark:bg-slate-800`}
      data-testid="listing-card-media"
      onMouseLeave={() => setIndex(0)}
    >
      <Link href={href} className="block h-full w-full">
        {active ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={active}
            alt=""
            data-testid="listing-card-image"
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/15 to-slate-200 text-3xl font-semibold text-slate-500 dark:from-brand/25 dark:to-slate-800">
            {(listing.artist ?? listing.title)?.slice(0, 1)?.toUpperCase() ?? '♪'}
          </div>
        )}
      </Link>
      {hasMany && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            className="absolute left-1 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-slate-800 shadow group-hover:flex"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              show(index - 1)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            className="absolute right-1 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-slate-800 shadow group-hover:flex"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              show(index + 1)
            }}
          >
            ›
          </button>
          <span
            data-testid="listing-card-image-count"
            className="absolute bottom-1 right-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >
            {images.length} photos
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-slate-900/50 to-transparent pb-1.5 pt-4">
            {images.slice(0, 5).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
      {ended && (
        <div
          data-testid="listing-card-ended-overlay"
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/55 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-white"
        >
          Ended
        </div>
      )}
    </div>
  )
}
