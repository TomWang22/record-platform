'use client'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { WatchlistBrowse } from '@/components/watchlist/watchlist-browse'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function WatchlistPage() {
  const { authRequired } = useRequireAuth()

  if (authRequired) {
    return <AuthRequiredCard title="Sign in to view your watchlist" returnTo="/watchlist" />
  }

  return <WatchlistBrowse />
}
