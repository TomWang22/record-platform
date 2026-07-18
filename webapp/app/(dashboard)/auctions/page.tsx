'use client'

import { useEffect, useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { SellerAuctionDashboardPanel } from '@/components/ai/intelligence/seller-auction-dashboard-panel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'
import { useRequireAuth } from '@/lib/use-require-auth'

type AuctionItem = {
  id: string
  title: string
  currentBid: number
  currency: string
  timeLeft: string
  url: string
  watchers?: number
  bids?: number
}

type AuctionTrend = {
  timestamp: string
  bid: number
  watchers: number
  bids: number
}

export default function AuctionsPage(): ReactElement {
  const { authRequired, onApiError } = useRequireAuth()
  const [auctions, setAuctions] = useState<AuctionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [monitoring, setMonitoring] = useState(false)
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null)
  const [trendData, setTrendData] = useState<AuctionTrend[]>([])

  useEffect(() => {
    void fetchAuctions()
    // Poll for updates every 30 seconds
    const interval = setInterval(() => {
      void fetchAuctions()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedAuction) {
      void fetchTrendData(selectedAuction)
      const interval = setInterval(() => {
        void fetchTrendData(selectedAuction)
      }, 10000) // Update trend every 10 seconds
      return () => clearInterval(interval)
    }
  }, [selectedAuction])

  async function fetchTrendData(auctionId: string) {
    try {
      // Fetch trend data from auction-monitor service
      const response = await apiFetch<{ results: Array<{ sold_at?: string; created_at: string; price?: number; total_cost?: number }> }>(`/api/auctions/results/${auctionId}`, {
        auth: true,
      })
      
      // Transform auction results into trend data
      const trend: AuctionTrend[] = response.results.map((result, i) => ({
        timestamp: new Date(result.sold_at || result.created_at).toLocaleTimeString(),
        bid: result.price || result.total_cost || 0,
        watchers: 0, // Not available in current schema
        bids: i + 1,
      }))
      
      setTrendData(trend)
    } catch (error) {
      console.error('Failed to fetch trend data:', error)
      // Fallback to empty array
      setTrendData([])
    }
  }

  async function fetchAuctions() {
    setLoading(true)
    setStatus('')
    try {
      const data = await apiFetch<AuctionItem[]>('/api/auctions', {
        auth: true,
      })
      setAuctions(Array.isArray(data) ? data : [])
      if (Array.isArray(data) && data.length > 0) {
        setStatus(`Monitoring ${data.length} active auction${data.length !== 1 ? 's' : ''}`)
      }
    } catch (error) {
      if (onApiError(error)) return
      // Service not available - return empty array
      setAuctions([])
      if (error instanceof ApiError && error.status !== 404) {
        setStatus('Unable to fetch auctions. Service may be starting up.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function startMonitoring() {
    setMonitoring(true)
    setStatus('Starting auction monitoring...')
    try {
      // For now, monitor a default query - in the future, this could be based on user's collection
      await apiFetch('/api/auctions/monitor', {
        method: 'POST',
        auth: true,
        data: {
          query: 'vinyl record',
          source: 'ebay',
        },
      })
      setStatus('Monitoring started')
      void fetchAuctions()
    } catch (error) {
      handleApiError(error)
    } finally {
      setMonitoring(false)
    }
  }

  function handleApiError(error: unknown) {
    if (onApiError(error)) return
    setStatus(error instanceof Error ? error.message : 'Something went wrong')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Auction Monitor</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track active auctions for records in your collection. Powered by Kafka streaming.
          </p>
        </div>
        <Button onClick={startMonitoring} disabled={monitoring || loading}>
          {monitoring ? 'Starting...' : 'Start Monitoring'}
        </Button>
      </div>

      {authRequired && (
        <AuthRequiredCard
          title="Sign in to monitor auctions"
          description="Track watchlists, bids, and auction results from your collection."
          returnTo="/auctions"
        />
      )}

      {!authRequired && <SellerAuctionDashboardPanel listingIds={auctions.map((a) => a.id)} />}

      {!authRequired && status && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </Card>
      )}

      {!authRequired && auctions.length === 0 && !loading && (
        <Card>
          <div className="py-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No active auctions</h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Start monitoring to track auctions for records in your collection.
            </p>
            <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
              Note: Auction monitoring service integration is in progress. This page will show real-time auction data once connected.
            </p>
          </div>
        </Card>
      )}

      {loading && (
        <Card>
          <p className="text-sm text-slate-500">Loading auctions...</p>
        </Card>
      )}

      {!authRequired && auctions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <div
              key={auction.id}
              className={`hover:shadow-lg transition-shadow cursor-pointer ${
                selectedAuction === auction.id ? 'ring-2 ring-brand' : ''
              }`}
              onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
            >
              <Card>
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-2">{auction.title}</h3>
                
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-brand">
                    {auction.currency} {auction.currentBid.toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Time left: {auction.timeLeft}</span>
                  {auction.bids !== undefined && <span>{auction.bids} bids</span>}
                </div>

                {auction.watchers !== undefined && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {auction.watchers} watcher{auction.watchers !== 1 ? 's' : ''}
                  </div>
                )}

                <Button variant="secondary" size="sm" className="w-full" asChild onClick={(e) => e.stopPropagation()}>
                  <a href={auction.url} target="_blank" rel="noopener noreferrer">
                    View Auction
                  </a>
                </Button>
              </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Auction Trend Chart */}
      {selectedAuction && trendData.length > 0 && (
        <Card title="Bid Trend" description="Track how the auction price climbs over time">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">Latest Bid</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  ${trendData[trendData.length - 1]?.bid.toFixed(2) || '0.00'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">Total Bids</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {trendData[trendData.length - 1]?.bids || 0}
                </p>
              </div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">Data Points</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {trendData.length}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {trendData.slice(-10).reverse().map((point, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-900 p-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-400">{point.timestamp}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">${point.bid.toFixed(2)}</span>
                  <span className="text-slate-500 dark:text-slate-400">{point.bids} bids</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Click an auction card above to view its trend</span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAuction(null)}>
              Close Chart
            </Button>
          </div>
        </Card>
      )}

      {/* Kafka Status Indicator */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Kafka Streaming</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time auction updates via Kafka topics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Connected</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

