'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type ActivityEvent = {
  id: string
  source: string
  event: string
  price?: number
  currency?: string
  marketplaceRef?: string
  ts: string
  topic?: string
}

const MAX_EVENTS = 40

export default function MessagesPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) {
      setConnected(false)
      return
    }
    const stream = new EventSource('/api/messages/stream')
    stream.onopen = () => setConnected(true)
    stream.onerror = () => setConnected(false)
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as ActivityEvent
        setEvents((prev) => [payload, ...prev].slice(0, MAX_EVENTS))
      } catch (error) {
        console.warn('failed to parse stream event', error)
      }
    }
    return () => {
      stream.close()
    }
  }, [paused])

  const latest = events[0]
  const kafkaTopic = latest?.topic ?? 'record-platform.activity'

  const groupedBySource = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] ?? 0) + 1
      return acc
    }, {})
  }, [events])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Message stream</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live Kafka (soon) updates for user activity — mirrors Discogs/eBay style watchlists and bids.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setPaused((prev) => !prev)}>
          {paused ? 'Resume stream' : 'Pause stream'}
        </Button>
      </header>

      <section className="grid gap-5 lg:grid-cols-3">
        <Card title="Stream status" className="flex flex-col gap-3">
          <p className="text-sm">
            Status:{' '}
            <span className={connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}>
              {connected ? 'Connected' : 'Idle'}
            </span>
          </p>
          <p className="text-sm">Events received: {events.length}</p>
          <p className="text-sm">Kafka topic: {kafkaTopic}</p>
          <div>
            <p className="text-xs uppercase text-slate-400">Sources</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {Object.entries(groupedBySource).map(([source, count]) => (
                <li key={source} className="flex items-center justify-between">
                  <span>{source}</span>
                  <span>{count}</span>
                </li>
              ))}
              {events.length === 0 && <li className="text-slate-400">waiting for events…</li>}
            </ul>
          </div>
        </Card>

        <Card
          title="Live feed"
          description="Messages stream from /api/messages/stream (Kafka bridge soon)."
          className="lg:col-span-2"
        >
          {events.length === 0 && <p className="text-sm text-slate-400">No messages yet.</p>}
          {events.length > 0 && (
            <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-2">
              {events.map((event) => (
                <li key={event.id} className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{event.source}</p>
                    <p className="text-xs text-slate-400">{new Date(event.ts).toLocaleTimeString()}</p>
                  </div>
                  <p className="mt-2 text-base font-medium capitalize text-slate-900 dark:text-white">
                    {event.event.replace(/_/g, ' ')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                    {event.price && (
                      <span className="font-semibold text-slate-900 dark:text-white">
                        ${event.price.toFixed(2)} {event.currency}
                      </span>
                    )}
                    {event.marketplaceRef && <span>Lot #{event.marketplaceRef}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}

