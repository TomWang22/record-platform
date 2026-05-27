'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { clearRecentlyViewed, getRecentlyViewed, type StoredListingRef } from '@/lib/local-marketplace-storage'

export default function RecentlyViewedPage() {
  const [items, setItems] = useState<StoredListingRef[]>([])

  useEffect(() => {
    setItems(getRecentlyViewed())
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Recently viewed</h1>
          <p className="text-sm text-slate-500">Guest and signed-in history (localStorage).</p>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" onClick={() => { clearRecentlyViewed(); setItems([]) }}>Clear history</Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card><p className="text-sm text-slate-500">Open listing details to build your history.</p></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={`${item.id}-${item.viewedAt}`}>
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-slate-500">{item.viewedAt ? new Date(item.viewedAt).toLocaleString() : ''}</p>
              <Button className="mt-3" size="sm" asChild><Link href="/listings">Browse</Link></Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
