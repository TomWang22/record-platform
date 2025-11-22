'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type RecordStats = {
  total: number
  formats: Record<string, number>
  recentlyAdded: number
  forSale: number
  inAuctions: number
}

export default function DashboardHome() {
  const router = useRouter()
  const [stats, setStats] = useState<RecordStats>({
    total: 0,
    formats: {},
    recentlyAdded: 0,
    forSale: 0,
    inAuctions: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchStats()
  }, [])

  async function fetchStats() {
    setLoading(true)
    try {
      // Fetch all records to calculate stats
      const records = await apiFetch<any[]>('/records', { auth: true })
      
      const formats: Record<string, number> = {}
      let recentlyAdded = 0
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      records.forEach((record) => {
        // Count formats
        const format = record.format || 'Unknown'
        formats[format] = (formats[format] || 0) + 1

        // Count recently added
        if (record.createdAt) {
          const created = new Date(record.createdAt)
          if (created >= thirtyDaysAgo) recentlyAdded++
        }
      })

      setStats({
        total: records.length,
        formats,
        recentlyAdded,
        forSale: 0, // TODO: integrate with listings service
        inAuctions: 0, // TODO: integrate with auction-monitor
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
        return
      }
      console.error('Failed to fetch stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const topFormats = Object.entries(stats.formats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">My Collection</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your vinyl catalog, track listings, and monitor auctions
          </p>
        </div>
        <Button asChild>
          <Link href="/records/new">Add Record</Link>
        </Button>
      </div>

      {/* Main Stats Grid */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-brand/10 to-brand/5 dark:from-brand/20 dark:to-brand/10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total Records
          </p>
          <p className="mt-2 text-4xl font-bold text-slate-900 dark:text-white">
            {loading ? '...' : stats.total.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {stats.recentlyAdded > 0 && `+${stats.recentlyAdded} this month`}
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            For Sale
          </p>
          <p className="mt-2 text-4xl font-bold text-slate-900 dark:text-white">
            {loading ? '...' : stats.forSale}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active listings
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            In Auctions
          </p>
          <p className="mt-2 text-4xl font-bold text-slate-900 dark:text-white">
            {loading ? '...' : stats.inAuctions}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Being monitored
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Formats
          </p>
          <p className="mt-2 text-4xl font-bold text-slate-900 dark:text-white">
            {loading ? '...' : Object.keys(stats.formats).length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Different formats
          </p>
        </Card>
      </section>

      {/* Format Breakdown */}
      {topFormats.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Format Breakdown</h2>
          <div className="mt-4 space-y-2">
            {topFormats.map(([format, count]) => {
              const percentage = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              return (
                <div key={format} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900 dark:text-white">{format}</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {count} ({percentage}%)
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full bg-brand transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Quick Actions */}
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" asChild>
          <Link href="/records">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 dark:bg-brand/20">
                <svg className="h-6 w-6 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Browse Collection</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">View and search all records</p>
              </div>
            </div>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" asChild>
          <Link href="/market">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                <svg className="h-6 w-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Sell / List</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Create marketplace listings</p>
              </div>
            </div>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" asChild>
          <Link href="/auctions">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Auction Monitor</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Track active auctions</p>
              </div>
            </div>
          </Link>
        </Card>
      </section>
    </div>
  )
}












