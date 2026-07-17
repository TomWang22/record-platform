'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { OfferNegotiationAssist } from '@/components/ai/intelligence/offer-negotiation-assist'
import {
  acceptOffer,
  counterOffer,
  dollarsToCents,
  rejectOffer,
  withdrawOffer,
  type PublicOffer,
} from '@/lib/offers-api'
import { getUserIdFromToken } from '@/lib/jwt-user'
import { getClientSessionToken } from '@/lib/session'

type Props = {
  items: PublicOffer[]
  mode: 'inbox' | 'sent'
  onRefresh: () => Promise<void>
}

export function OffersListPanel({ items, mode, onRefresh }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [counterFor, setCounterFor] = useState<string | null>(null)
  const [counterAmount, setCounterAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const currentUserId = getUserIdFromToken(getClientSessionToken())

  async function runAction(offer: PublicOffer, fn: () => Promise<unknown>) {
    setBusyId(offer.id)
    setError(null)
    try {
      await fn()
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusyId(null)
      setCounterFor(null)
      setCounterAmount('')
    }
  }

  if (items.length === 0) {
    return (
      <Card className="p-6 text-sm text-slate-500" data-testid="offers-empty">
        No offers to show.
      </Card>
    )
  }

  return (
    <div className="space-y-3" data-testid={`offers-list-${mode}`}>
      {error && (
        <p className="text-sm text-red-600" data-testid="offers-action-error">
          {error}
        </p>
      )}
      {items.map((offer) => (
        <Card
          key={offer.id}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="offers-list-item"
        >
          <div className="min-w-0 space-y-1">
            <Link
              href={`/listings/${offer.listingId}`}
              className="font-medium text-brand hover:underline"
              data-testid="offers-listing-link"
            >
              {offer.listingTitle ?? 'Listing'}
            </Link>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {mode === 'inbox' ? (
                <>
                  From <span data-testid="offers-participant">{offer.buyer}</span>
                </>
              ) : (
                <>
                  To <span data-testid="offers-participant">{offer.seller}</span>
                </>
              )}
            </p>
            <p className="text-lg font-semibold" data-testid="offers-amount">
              {offer.amountDisplay}
            </p>
            <p className="text-xs text-slate-500" data-testid="offers-status">
              {offer.statusDisplay}
              {offer.expiresAtDisplay ? ` · expires ${offer.expiresAtDisplay}` : ''}
            </p>
            {offer.message && (
              <p className="text-sm text-slate-500">&ldquo;{offer.message}&rdquo;</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === 'inbox' && ['pending', 'countered'].includes(offer.status) && (
              <>
                <Button
                  size="sm"
                  disabled={busyId === offer.id}
                  onClick={() =>
                    void runAction(offer, () => acceptOffer(offer.listingId, offer.id))
                  }
                  data-testid="offers-accept"
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === offer.id}
                  onClick={() =>
                    void runAction(offer, () => rejectOffer(offer.listingId, offer.id))
                  }
                  data-testid="offers-reject"
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === offer.id}
                  onClick={() => setCounterFor(offer.id)}
                  data-testid="offers-counter-toggle"
                >
                  Counter
                </Button>
              </>
            )}
            {mode === 'sent' && ['pending', 'countered'].includes(offer.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === offer.id}
                onClick={() =>
                  void runAction(offer, () => withdrawOffer(offer.listingId, offer.id))
                }
                data-testid="offers-withdraw"
              >
                Withdraw
              </Button>
            )}
          </div>
          {counterFor === offer.id && (
            <div className="flex w-full flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
              <label className="text-xs font-medium text-slate-600">
                Counter (USD)
                <input
                  className="mt-1 block w-32 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  value={counterAmount}
                  onChange={(e) => setCounterAmount(e.target.value)}
                  data-testid="offers-counter-amount"
                />
              </label>
              <Button
                size="sm"
                disabled={busyId === offer.id}
                onClick={() => {
                  const cents = dollarsToCents(counterAmount)
                  if (cents == null) {
                    setError('Invalid counter amount')
                    return
                  }
                  void runAction(offer, () =>
                    counterOffer(offer.listingId, offer.id, { amountCents: cents }),
                  )
                }}
                data-testid="offers-counter-submit"
              >
                Send counter
              </Button>
            </div>
          )}
          <div className="w-full border-t border-slate-100 pt-3 dark:border-white/10">
            <OfferNegotiationAssist
              offer={offer}
              role={mode === 'inbox' ? 'seller' : 'buyer'}
              currentUserId={currentUserId}
            />
          </div>
        </Card>
      ))}
    </div>
  )
}
