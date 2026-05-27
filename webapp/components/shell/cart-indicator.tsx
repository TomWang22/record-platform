'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { getGuestCartCount } from '@/lib/local-marketplace-storage'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

type CartPreview = {
  items: Array<{
    id: string
    title?: string
    quantity: number
    price?: number
  }>
  total_items: number
  total_price: number
}

export function CartIndicator() {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [preview, setPreview] = useState<CartPreview | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    void refreshCount()
    const id = window.setInterval(() => void refreshCount(), 30_000)
    return () => window.clearInterval(id)
  }, [session.status])

  async function refreshCount() {
    if (isSessionAuthenticated(session)) {
      try {
        const data = await apiFetch<CartPreview>('/api/cart', { auth: true })
        setCount(data.total_items ?? data.items?.length ?? 0)
        setPreview(data)
      } catch {
        setCount(0)
        setPreview({ items: [], total_items: 0, total_price: 0 })
      }
      return
    }
    setCount(getGuestCartCount())
    setPreview(null)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          void refreshCount()
        }}
        className="relative rounded-full border border-slate-200/80 bg-white p-2 text-slate-700 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        aria-label={`Cart, ${count} items`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-slate-950">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Cart</p>
          <p className="text-xs text-slate-500">{count} item{count === 1 ? '' : 's'}</p>

          {preview && preview.items.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
              {preview.items.slice(0, 5).map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="truncate">{item.title ?? 'Listing'}</span>
                  <span className="shrink-0 text-slate-500">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Your cart is empty.</p>
          )}

          {preview && preview.total_price > 0 && (
            <p className="mt-2 text-sm font-medium">
              Subtotal: ${preview.total_price.toFixed(2)}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Button asChild size="sm" className="flex-1">
              <Link href="/cart" onClick={() => setOpen(false)}>View cart</Link>
            </Button>
            {count > 0 && (
              <Button asChild size="sm" variant="secondary" className="flex-1">
                <Link href="/cart" onClick={() => setOpen(false)}>Checkout</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
