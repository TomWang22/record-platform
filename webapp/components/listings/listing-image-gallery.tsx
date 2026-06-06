'use client'

import { useState } from 'react'

type Props = {
  images: string[]
}

export function ListingImageGallery({ images }: Props) {
  const [selected, setSelected] = useState(0)
  const primary = images[selected] ?? images[0]

  if (!primary) {
    return (
      <div
        className="flex aspect-[4/3] max-h-72 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500 dark:bg-slate-800"
        data-testid="listing-gallery"
      >
        No media
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="listing-gallery">
      <div className="flex h-[min(280px,36vh)] max-h-72 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 p-2 dark:border-white/10 dark:bg-slate-900/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primary}
          alt=""
          data-testid="listing-primary-image"
          className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
        />
      </div>
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2" data-testid="listing-gallery-thumbnails">
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => setSelected(i)}
              className={`h-14 w-14 overflow-hidden rounded-lg border-2 transition ${
                i === selected
                  ? 'border-brand'
                  : 'border-transparent opacity-80 hover:opacity-100'
              }`}
              aria-label={`Image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
