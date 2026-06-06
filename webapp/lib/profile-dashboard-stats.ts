import { apiFetch } from '@/lib/api-client'

export type ProfileDashboardStats = {
  recordsCount: number
  feedbackScore: string
  activeListings: number
  soldListings: number
  purchasesCount: number
}

function listingRows(body: { items?: { status?: string }[]; listings?: { status?: string }[] }) {
  return body.items ?? body.listings ?? []
}

function isActiveStatus(status?: string): boolean {
  const s = String(status ?? 'active').toLowerCase()
  return s === 'active' || s === 'published' || s === 'draft'
}

function isSoldStatus(status?: string): boolean {
  const s = String(status ?? '').toLowerCase()
  return s === 'sold' || s === 'archived' || s === 'closed'
}

export async function fetchProfileDashboardStats(): Promise<ProfileDashboardStats> {
  const records = await apiFetch<{ purchaseType?: string; purchasedAt?: string }[]>('/api/records', {
    auth: true,
  })
  const feedback = await apiFetch<{ positivePercent?: number; totalReviews?: number }>(
    '/api/feedback/me',
    { auth: true },
  ).catch(() => ({ positivePercent: undefined, totalReviews: 0 }))
  const mine = await apiFetch<{ items?: { status?: string }[]; listings?: { status?: string }[] }>(
    '/api/listings/mine',
    { auth: true },
  ).catch(() => ({ items: [] }))

  const rows = listingRows(mine)
  const purchasesCount = records.filter(
    (r) => Boolean(r.purchasedAt) || Boolean(String(r.purchaseType ?? '').trim()),
  ).length

  const feedbackScore =
    feedback.positivePercent != null
      ? `${Math.round(feedback.positivePercent)}%`
      : (feedback.totalReviews ?? 0) > 0
        ? String(feedback.totalReviews)
        : '—'

  return {
    recordsCount: records.length,
    feedbackScore,
    activeListings: rows.filter((r) => isActiveStatus(r.status)).length,
    soldListings: rows.filter((r) => isSoldStatus(r.status)).length,
    purchasesCount,
  }
}
