'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { useRequireAuth } from '@/lib/use-require-auth'

type CartItem = {
  id: string
  listing_id?: string
  item_type: string
  item_id: string
  quantity: number
  price?: number
  notes?: string
  metadata?: Record<string, unknown>
  // Enriched fields from listings DB
  title?: string
  condition?: string
  catalog_id?: string
  image_url?: string
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
  const { authRequired, onApiError, session, isReady } = useRequireAuth()
  const [cart, setCart] = useState<Cart | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [warning, setWarning] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)

  useEffect(() => {
    if (!isReady) return
    if (session.status === 'unauthenticated') {
      setLoading(false)
      return
    }
    if (session.status === 'authenticated') {
      void loadCart()
    }
  }, [isReady, session.status])

  async function loadCart() {
    setLoading(true)
    setError(null)
    setWarning('')
    try {
      const data = await apiFetch<Cart>('/api/cart', { auth: true })
      setCart({
        items: Array.isArray(data?.items) ? data.items : [],
        total_items: data?.total_items ?? data?.items?.length ?? 0,
        total_price: data?.total_price ?? 0,
        removed_items: data?.removed_items,
      })
      if (data.removed_items && data.removed_items > 0) {
        setWarning(`${data.removed_items} item(s) were removed from your cart because they are no longer available.`)
      }
    } catch (err) {
      if (!onApiError(err)) {
        setError(err)
      }
    } finally {
      setLoading(false)
    }
  }

  async function removeItem(itemId: string) {
    try {
      await apiFetch(`/api/cart/${itemId}`, {
        method: 'DELETE',
        auth: true,
      })
      void loadCart()
    } catch (err) {
      setError(err)
    }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      await removeItem(itemId)
      return
    }
    try {
      await apiFetch(`/api/cart/${itemId}`, {
        method: 'PUT',
        auth: true,
        data: { quantity },
      })
      void loadCart()
    } catch (err) {
      setError(err)
    }
  }

  async function updateNotes(itemId: string, notes: string) {
    try {
      await apiFetch(`/api/cart/${itemId}`, {
        method: 'PUT',
        auth: true,
        data: { notes },
      })
      // Optionally reload cart, or just update local state for better UX
      if (cart) {
        setCart({
          ...cart,
          items: cart.items.map(item =>
            item.id === itemId ? { ...item, notes } : item
          ),
        })
      }
    } catch (err) {
      setError(err)
    }
  }

  async function checkout() {
    if (!cart || cart.items.length === 0) {
      setWarning('Your cart is empty')
      return
    }

    setCheckingOut(true)
    setError(null)
    try {
      const items = cart.items.map((item) => ({
        item_type: item.item_type,
        item_id: item.item_id,
        listing_id: item.listing_id,
      }))

      await apiFetch('/api/cart/checkout', {
        method: 'POST',
        auth: true,
        data: { items },
      })

      // Cart will be cleared after checkout
      setCart({ items: [], total_items: 0, total_price: 0 })
      alert('Checkout successful! Items have been purchased.')
      router.push('/dashboard')
    } catch (err) {
      setError(err)
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

      {authRequired && (
        <AuthRequiredCard
          title="Sign in to view your cart"
          description="Your shopping cart and checkout are available after you sign in."
          returnTo="/cart"
        />
      )}

      {warning && !authRequired && (
        <div className="rounded-xl border border-yellow-200/80 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/50 dark:text-yellow-400">
          {warning}
        </div>
      )}

      {!authRequired && error && (
        <ApiErrorAlert title="Cart request failed" error={error} onRetry={() => void loadCart()} />
      )}

      {!authRequired &&
        (cart === null || cart.items.length === 0 ? (
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
          {/* Cart Items - Amazon-style layout */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Shopping Cart ({cart.items.length} {cart.items.length === 1 ? 'item' : 'items'})
              </h2>
            </Card>
            
            {cart.items.map((item) => {
              const itemTitle: string = typeof item.title === 'string' ? item.title : (typeof item.metadata?.title === 'string' ? item.metadata.title : `Item ${item.item_id.substring(0, 8)}`)
              const itemImage: string | undefined = typeof item.image_url === 'string' ? item.image_url : (typeof item.metadata?.image_url === 'string' ? item.metadata.image_url : undefined)
              const itemCondition: string | undefined = typeof item.condition === 'string' ? item.condition : (typeof item.metadata?.condition === 'string' ? item.metadata.condition : undefined)
              const itemCatalogId: string | undefined = typeof item.catalog_id === 'string' ? item.catalog_id : (typeof item.metadata?.catalog_id === 'string' ? item.metadata.catalog_id : undefined)
              const itemPrice = item.price || 0
              const itemTotal = itemPrice * item.quantity
              
              return (
                <Card key={item.id} className="p-4">
                  <div className="flex gap-4">
                    {/* Image Column */}
                    <div className="flex-shrink-0">
                      {itemImage ? (
                        <img
                          src={itemImage}
                          alt={itemTitle}
                          className="w-32 h-32 object-cover rounded-lg border border-slate-200 dark:border-white/10"
                        />
                      ) : (
                        <div className="w-32 h-32 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                          <span className="text-slate-400 text-xs">No Image</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Details Column */}
                    <div className="flex-1 min-w-0">
                      {/* Title */}
                      <h3 className="font-semibold text-slate-900 dark:text-white mb-1 line-clamp-2">
                        {itemTitle}
                      </h3>
                      
                      {/* Condition and Catalog ID */}
                      <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 mb-2">
                        {itemCondition && (
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                            Condition: {itemCondition}
                          </span>
                        )}
                        {itemCatalogId && (
                          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 rounded text-blue-700 dark:text-blue-300">
                            Catalog: {itemCatalogId}
                          </span>
                        )}
                      </div>
                      
                      {/* Notes Column - Editable */}
                      <div className="mb-2">
                        <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                          Notes (to differentiate items):
                        </label>
                        <input
                          type="text"
                          value={item.notes || ''}
                          onChange={(e) => void updateNotes(item.id, e.target.value)}
                          placeholder="e.g., Has minor scratch on side, Original packaging"
                          className="w-full rounded border border-slate-200/80 bg-white px-2 py-1 text-xs text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                        />
                      </div>
                      
                      {/* Price and Quantity Controls */}
                      <div className="flex items-center justify-between mt-3">
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
                          <div className="text-sm text-slate-600 dark:text-slate-400">
                            <span className="font-medium">Price:</span> ${itemPrice.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-slate-900 dark:text-white">
                            ${itemTotal.toFixed(2)}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void removeItem(item.id)}
                            className="text-rose-600 hover:text-rose-700 mt-1 text-xs"
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      
                      {/* Availability Warning */}
                      {item.availability && (!item.availability.is_active || item.availability.sold_at || item.availability.stock_quantity <= 0) && (
                        <p className="text-xs text-rose-600 mt-2">⚠️ This item is no longer available</p>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
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
      ))}
    </div>
  )
}

