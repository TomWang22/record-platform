'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type CartItem = {
  id: string
  listing_id?: string
  item_type: string
  item_id: string
  quantity: number
  price?: number
  metadata?: any
  availability?: {
    is_active: boolean
    sold_at?: string
    stock_quantity: number
  }
}

type Cart = {
  items: CartItem[]
  total_items: number
  total_price: number
  removed_items?: number
}

export default function CartPage() {
  const router = useRouter()
  const [cart, setCart] = useState<Cart | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)

  useEffect(() => {
    void loadCart()
  }, [])

  async function loadCart() {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<Cart>('/shopping/cart', { auth: true })
      setCart(data)
      if (data.removed_items && data.removed_items > 0) {
        setError(`${data.removed_items} item(s) were removed from your cart because they are no longer available.`)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load cart')
      }
    } finally {
      setLoading(false)
    }
  }

  async function removeItem(itemId: string) {
    try {
      await apiFetch(`/shopping/cart/${itemId}`, {
        method: 'DELETE',
        auth: true,
      })
      void loadCart()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove item')
    }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      await removeItem(itemId)
      return
    }
    try {
      await apiFetch(`/shopping/cart/${itemId}`, {
        method: 'PUT',
        auth: true,
        data: { quantity },
      })
      void loadCart()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quantity')
    }
  }

  async function checkout() {
    if (!cart || cart.items.length === 0) {
      setError('Your cart is empty')
      return
    }

    setCheckingOut(true)
    setError('')
    try {
      const items = cart.items.map((item) => ({
        item_type: item.item_type,
        item_id: item.item_id,
        listing_id: item.listing_id,
      }))

      await apiFetch('/shopping/cart/checkout', {
        method: 'POST',
        auth: true,
        data: { items },
      })

      // Cart will be cleared after checkout
      setCart({ items: [], total_items: 0, total_price: 0 })
      alert('Checkout successful! Items have been purchased.')
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Shopping Cart</h1>
        </header>
        <p className="text-sm text-slate-500">Loading cart...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Shopping Cart</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Review your items before checkout. Sold-out items are automatically removed.
        </p>
      </header>

      {error && (
        <div className={`rounded-xl border p-3 text-sm ${
          error.includes('removed') 
            ? 'border-yellow-200/80 bg-yellow-50 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/50 dark:text-yellow-400'
            : 'border-rose-200/80 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-400'
        }`}>
          {error}
        </div>
      )}

      {!cart || cart.items.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-slate-500 dark:text-slate-400 mb-4">Your cart is empty</p>
            <Link href="/listings">
              <Button>Browse Listings</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            {cart.items.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex gap-4">
                  {item.metadata?.image_url && (
                    <img
                      src={item.metadata.image_url}
                      alt={item.metadata.title || 'Item'}
                      className="w-24 h-24 object-cover rounded-lg"
                    />
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                      {item.metadata?.title || `Item ${item.item_id.substring(0, 8)}`}
                    </h3>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-slate-600 dark:text-slate-400">Qty:</label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => void updateQuantity(item.id, parseInt(e.target.value) || 1)}
                            className="w-16 rounded border border-slate-200/80 bg-white px-2 py-1 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                          />
                        </div>
                        <span className="text-lg font-bold text-slate-900 dark:text-white">
                          {item.price ? `$${(item.price * item.quantity).toFixed(2)}` : 'Price N/A'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeItem(item.id)}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        Remove
                      </Button>
                    </div>
                    {item.availability && (!item.availability.is_active || item.availability.sold_at || item.availability.stock_quantity <= 0) && (
                      <p className="text-xs text-rose-600 mt-2">⚠️ This item is no longer available</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Cart Summary */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Order Summary
              </h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Items ({cart.total_items})</span>
                  <span className="text-slate-900 dark:text-white">${cart.total_price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Shipping</span>
                  <span className="text-slate-900 dark:text-white">Calculated at checkout</span>
                </div>
                <div className="border-t border-slate-200 dark:border-white/10 pt-3 flex justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">Total</span>
                  <span className="font-bold text-lg text-slate-900 dark:text-white">
                    ${cart.total_price.toFixed(2)}
                  </span>
                </div>
              </div>
              <Button
                onClick={() => void checkout()}
                disabled={checkingOut || cart.items.length === 0}
                className="w-full"
              >
                {checkingOut ? 'Processing...' : 'Checkout'}
              </Button>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 text-center">
                By checking out, you agree to our terms of service
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

