'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getWatchlist, removeFromWatchlist, type StoredListingRef } from '@/lib/local-marketplace-storage'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function WatchlistPage() {
  const { authRequired } = useRequireAuth()
  const [items, setItems] = useState<StoredListingRef[]>([])

  useEffect(() => {
    setItems(getWatchlist())
  }, [])

  if (authRequired) {
    return <AuthRequiredCard title="Sign in to view your watchlist" returnTo="/watchlist" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Watchlist</h1>
          <p className="text-sm text-slate-500">Saved listings (local until API is wired).</p>
        </div>
        <Button variant="ghost" asChild><Link href="/listings">Browse listings</Link></Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No watched listings yet. Use Watch on a listing card.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id}>
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />
              )}
              <p className="font-medium">{item.title}</p>
              {item.artist && <p className="text-sm text-slate-500">{item.artist}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" asChild><Link href={`/listings?id=${item.id}`}>View</Link></Button>
                <Button size="sm" variant="ghost" onClick={() => { removeFromWatchlist(item.id); setItems(getWatchlist()) }}>Remove</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
