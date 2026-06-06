export type FeedbackSummary = {
  score: number
  totalReviews: number
  positive: number
  neutral: number
  negative: number
  averageStars: number
  distribution: { stars: number; count: number }[]
  reviews: {
    id: string
    stars: number
    sentiment: 'positive' | 'neutral' | 'negative'
    role: 'buyer' | 'seller'
    body: string
    listingTitle?: string
    createdAt: string
  }[]
}

export type AppNotification = {
  id: string
  type: string
  title: string
  body: string
  href: string
  read: boolean
  createdAt: string
}

export const DEMO_FEEDBACK: FeedbackSummary = {
  score: 98,
  totalReviews: 24,
  positive: 22,
  neutral: 1,
  negative: 1,
  averageStars: 4.8,
  distribution: [
    { stars: 5, count: 18 },
    { stars: 4, count: 4 },
    { stars: 3, count: 1 },
    { stars: 2, count: 0 },
    { stars: 1, count: 1 },
  ],
  reviews: [
    {
      id: '1',
      stars: 5,
      sentiment: 'positive',
      role: 'buyer',
      body: 'Record matched description, packed well, fast ship.',
      listingTitle: 'Kind of Blue — VG+',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: '2',
      stars: 4,
      sentiment: 'positive',
      role: 'seller',
      body: 'Smooth transaction.',
      listingTitle: 'Blue Train — NM',
      createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    },
    {
      id: '3',
      stars: 5,
      sentiment: 'positive',
      role: 'buyer',
      body: 'Excellent communication.',
      createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
    {
      id: '4',
      stars: 3,
      sentiment: 'neutral',
      role: 'buyer',
      body: 'Arrived safely; sleeve had minor wear.',
      createdAt: new Date(Date.now() - 86400000 * 25).toISOString(),
    },
    {
      id: '5',
      stars: 1,
      sentiment: 'negative',
      role: 'buyer',
      body: 'Not as described — resolved with partial refund.',
      createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
    },
  ],
}

const DEMO_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n1',
    type: 'outbid',
    title: 'Auction price spike',
    body: 'Miles Davis — Kind of Blue moved up 12%',
    href: '/listings',
    read: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'n2',
    type: 'offer',
    title: 'Offer received',
    body: '$42 on your Blue Train listing',
    href: '/profile/selling',
    read: false,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'n3',
    type: 'sold',
    title: 'Item sold',
    body: 'Quiet Kenny sold — ship within 3 days',
    href: '/profile/selling?status=sold',
    read: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
]

async function fetchJsonWithTimeout<T>(path: string, ms = 4000): Promise<T | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(path, { credentials: 'include', signal: ac.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** @deprecated Use `@/lib/marketplace-feedback-api` — no demo fallback in contract path. */
export async function fetchFeedbackSummary(
  _username?: string,
): Promise<FeedbackSummary> {
  const { fetchFeedbackSummary: fetchApi } = await import('./marketplace-feedback-api')
  return fetchApi(_username)
}

/** @deprecated Use `@/lib/marketplace-notifications-api` — no demo fallback in contract path. */
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { fetchNotificationsFromApi } = await import('./marketplace-notifications-api')
  return fetchNotificationsFromApi()
}
