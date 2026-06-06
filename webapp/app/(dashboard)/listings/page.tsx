'use client'

import { Suspense } from 'react'

import { ListingsBrowse } from '@/components/listings/listings-browse'

export default function ListingsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading listings...</div>}>
      <ListingsBrowse />
    </Suspense>
  )
}
