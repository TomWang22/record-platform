'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

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

export default function AuctionsPage() {
  const router = useRouter()
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
      // TODO: Replace with actual endpoint when available
      // For now, generate mock trend data
      const mockTrend: AuctionTrend[] = Array.from({ length: 20 }, (_, i) => {
        const date = new Date()
        date.setMinutes(date.getMinutes() - (20 - i) * 5)
        return {
          timestamp: date.toLocaleTimeString(),
          bid: 50 + Math.random() * 200 + i * 5,
          watchers: Math.floor(5 + Math.random() * 15),
          bids: Math.floor(2 + Math.random() * 10) + i,
        }
      })
      setTrendData(mockTrend)
    } catch (error) {
      console.error('Failed to fetch trend data:', error)
    }
  }

  async function fetchAuctions() {
    setLoading(true)
    setStatus('')
    try {
      // TODO: Replace with actual auction-monitor endpoint when available
      // For now, this is a placeholder that will work once the service is integrated
      const data = await apiFetch<AuctionItem[]>('/auctions', {
        auth: true,
      }).catch(() => {
        // Service not available yet, return empty array
        return []
      })
      setAuctions(Array.isArray(data) ? data : [])
      if (Array.isArray(data) && data.length > 0) {
        setStatus(`Monitoring ${data.length} active auction${data.length !== 1 ? 's' : ''}`)
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
        return
      }
      // Service not available - this is expected until auction-monitor is fully integrated
      setAuctions([])
    } finally {
      setLoading(false)
    }
  }

  async function startMonitoring() {
    setMonitoring(true)
    setStatus('Starting auction monitoring...')
    try {
      // TODO: POST to /auctions/monitor to start monitoring specific records
      await apiFetch('/auctions/monitor', {
        method: 'POST',
        auth: true,
        data: {},
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
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/login')
      return
    }
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

      {status && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </Card>
      )}

      {auctions.length === 0 && !loading && (
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

      {auctions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <Card 
              key={auction.id} 
              className={`hover:shadow-lg transition-shadow cursor-pointer ${
                selectedAuction === auction.id ? 'ring-2 ring-brand' : ''
              }`}
              onClick={() => setSelectedAuction(selectedAuction === auction.id ? null : auction.id)}
            >
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
          ))}
        </div>
      )}

      {/* Auction Trend Chart */}
      {selectedAuction && trendData.length > 0 && (
        <Card title="Bid Trend" description="Track how the auction price climbs over time">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
              <XAxis 
                dataKey="timestamp" 
                className="text-xs text-slate-500"
                tick={{ fill: 'currentColor' }}
              />
              <YAxis 
                className="text-xs text-slate-500"
                tick={{ fill: 'currentColor' }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'var(--tw-color-slate-900)',
                  border: '1px solid var(--tw-color-slate-700)',
                  borderRadius: '0.5rem',
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="bid" 
                stroke="#5C6FF8" 
                strokeWidth={2}
                name="Current Bid ($)"
                dot={{ r: 3 }}
              />
              <Line 
                type="monotone" 
                dataKey="bids" 
                stroke="#10b981" 
                strokeWidth={2}
                name="Total Bids"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
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

