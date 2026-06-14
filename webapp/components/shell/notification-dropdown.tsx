'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  fetchNotificationsFromApi,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/marketplace-notifications-api'

const GROUP_ORDER = [
  'Messages',
  'Offers',
  'Auctions',
  'AI Insights',
  'Orders / Shipping',
  'System',
] as const

function notificationGroup(type: string): (typeof GROUP_ORDER)[number] {
  const t = type.toLowerCase()
  if (t.includes('message')) return 'Messages'
  if (t.includes('offer')) return 'Offers'
  if (
    t.includes('marketplace_ai') ||
    t.includes('aiinsight') ||
    t.includes('pricingrecommendation') ||
    t.includes('auctionriskdetected')
  ) {
    return 'AI Insights'
  }
  if (t.includes('auction')) return 'Auctions'
  if (t.includes('sold') || t.includes('shipping') || t.includes('order')) return 'Orders / Shipping'
  return 'System'
}

export function NotificationDropdown() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchNotificationsFromApi()
      setItems(rows)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 20_000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const unread = items.filter((n) => !n.read).length

  const grouped = useMemo(() => {
    const map = new Map<string, AppNotification[]>()
    for (const item of items) {
      const key = notificationGroup(item.type)
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g) ?? [] }))
  }, [items])

  async function markAllRead() {
    await markAllNotificationsRead()
    await load()
  }

  async function openNotification(n: AppNotification) {
    if (!n.read) {
      await markNotificationRead(n.id).catch(() => undefined)
      await load()
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref} data-testid="notification-dropdown">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full border border-slate-200/80 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
            data-testid="notification-unread-count"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-950"
          data-testid="notification-dropdown-panel"
        >
          <div className="flex items-center justify-between border-b px-3 py-2 dark:border-white/10">
            <p className="text-sm font-semibold">Notifications</p>
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications</p>
            ) : (
              grouped.map((section) => (
                <div key={section.label}>
                  <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {section.label}
                  </p>
                  <ul>
                    {section.items.map((n) => (
                      <li key={n.id} data-testid="notification-item">
                        <Link
                          href={n.href}
                          onClick={() => void openNotification(n)}
                          className={`block border-b px-3 py-3 text-sm hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5 ${!n.read ? 'bg-brand/5' : ''}`}
                        >
                          <p className="font-medium">{n.title}</p>
                          <p className="text-xs text-slate-500">{n.body}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
