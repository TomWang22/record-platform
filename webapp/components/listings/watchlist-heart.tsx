'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  addWatchlistOnApi,
  fetchWatchlistFromApi,
  removeWatchlistOnApi,
} from '@/lib/marketplace-shopping-api'
import type { StoredListingRef } from '@/lib/local-marketplace-storage'

type Props = {
  listing: StoredListingRef
  className?: string
  onToggle?: (watched: boolean) => void
}

export function WatchlistHeart({ listing, className = '', onToggle }: Props) {
  const [watched, setWatched] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const list = await fetchWatchlistFromApi()
    setWatched(list.some((x) => x.id === listing.id))
  }, [listing.id])

  useEffect(() => {
    void refresh().catch(() => setWatched(false))
  }, [refresh])

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      if (watched) {
        await removeWatchlistOnApi(listing.id)
        setWatched(false)
        onToggle?.(false)
      } else {
        await addWatchlistOnApi(listing)
        setWatched(true)
        onToggle?.(true)
      }
    } catch {
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-full border border-slate-200/80 bg-white/90 p-1.5 shadow-sm hover:scale-105 disabled:opacity-60 dark:border-white/10 dark:bg-slate-900/90 ${className}`}
      aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
      aria-pressed={watched}
    >
      <span className={`text-lg leading-none ${watched ? 'text-rose-500' : 'text-slate-400'}`}>
        {watched ? '♥' : '♡'}
      </span>
    </button>
  )
}
