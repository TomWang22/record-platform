'use client'

import { useEffect, useState } from 'react'

import { FeedbackStarChart } from '@/components/feedback/feedback-star-chart'
import { Card } from '@/components/ui/card'
import {
  fetchFeedbackSummary,
  type FeedbackSummary,
} from '@/lib/marketplace-feedback-api'

type Props = {
  username?: string
}

export function FeedbackPageContent({ username }: Props) {
  const [data, setData] = useState<FeedbackSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchFeedbackSummary(username)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load feedback')
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  if (loading) {
    return <p className="text-sm text-slate-500">Loading feedback…</p>
  }

  if (error) {
    return (
      <Card data-testid="feedback-error-state">
        <p className="text-sm text-rose-600">{error}</p>
      </Card>
    )
  }

  if (!data || data.totalReviews === 0) {
    return (
      <Card data-testid="feedback-empty-state-ready">
        <p className="text-sm text-slate-500">No reviews yet.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-testid="feedback-page-ready">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-3xl font-bold">{data.score}%</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Reviews</p>
          <p className="text-3xl font-bold">{data.totalReviews}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Avg stars</p>
          <p className="text-3xl font-bold">{data.averageStars.toFixed(1)}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Sentiment</p>
          <p className="text-sm">
            +{data.positive} / ~{data.neutral} / −{data.negative}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 font-semibold">Rating breakdown</h2>
        <div data-testid="feedback-chart">
          <FeedbackStarChart distribution={data.distribution} />
        </div>
        <ul className="mt-4 space-y-1 text-sm" aria-label="Star rating counts">
          {data.distribution.map((row) => (
            <li key={row.stars}>
              {row.stars} star: {row.count}
            </li>
          ))}
        </ul>
      </Card>

      <section>
        <h2 className="mb-3 font-semibold">Recent reviews</h2>
        <div className="space-y-3">
          {data.reviews.map((r) => (
            <Card key={r.id} data-testid="feedback-review-row">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{r.stars}★ · {r.sentiment}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                  {r.role}
                </span>
              </div>
              <p className="mt-2 text-sm">{r.body}</p>
              {r.listingTitle && (
                <p className="mt-1 text-xs text-slate-500">Listing: {r.listingTitle}</p>
              )}
              <time className="mt-2 block text-xs text-slate-400" dateTime={r.createdAt}>
                {new Date(r.createdAt).toLocaleString()}
              </time>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
