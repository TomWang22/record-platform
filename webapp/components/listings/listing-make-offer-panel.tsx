'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  dollarsToCents,
  fetchMyOffersForListing,
  fetchOfferSettings,
  submitOffer,
  type OfferSettings,
  type PublicOffer,
  withdrawOffer,
} from '@/lib/offers-api'

type Props = {
  listingId: string
  listingTitle: string
  autoOpen?: boolean
}

export function ListingMakeOfferPanel({ listingId, listingTitle, autoOpen }: Props) {
  const [settings, setSettings] = useState<OfferSettings | null>(null)
  const [myOffers, setMyOffers] = useState<PublicOffer[]>([])
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [open, setOpen] = useState(Boolean(autoOpen))

  const reload = useCallback(async () => {
    const [s, mine] = await Promise.all([
      fetchOfferSettings(listingId),
      fetchMyOffersForListing(listingId),
    ])
    setSettings(s)
    setMyOffers(mine.items ?? [])
  }, [listingId])

  useEffect(() => {
    void reload().catch(() => setSettings(null))
  }, [reload])

  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])

  if (!settings?.oboEnabled) return null

  const attemptsLeft = settings.attemptsRemaining
  const canSubmit =
    attemptsLeft == null || attemptsLeft > 0
      ? true
      : false

  async function onSubmit() {
    setError(null)
    setSuccess(null)
    const cents = dollarsToCents(amount)
    if (cents == null) {
      setError('Enter a valid offer amount.')
      return
    }
    setBusy(true)
    try {
      const offer = await submitOffer(listingId, {
        amountCents: cents,
        message: message.trim() || undefined,
      })
      setSuccess(`Offer submitted: ${offer.amountDisplay} (${offer.statusDisplay})`)
      setAmount('')
      setMessage('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Offer failed')
    } finally {
      setBusy(false)
    }
  }

  async function onWithdraw(offer: PublicOffer) {
    if (!['pending', 'countered'].includes(offer.status)) return
    setBusy(true)
    setError(null)
    try {
      await withdrawOffer(listingId, offer.id)
      setSuccess('Offer withdrawn.')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdraw failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="listing-make-offer-panel">
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Make an offer</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          data-testid="listing-make-offer-toggle"
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && (
        <>
          <p className="text-xs text-slate-500" data-testid="listing-offer-listing-title">
            {listingTitle}
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            {settings.minOfferDisplay && (
              <>
                <dt>Minimum</dt>
                <dd data-testid="listing-offer-min">{settings.minOfferDisplay}</dd>
              </>
            )}
            <dt>Attempts left</dt>
            <dd data-testid="listing-offer-attempts-remaining">
              {attemptsLeft != null ? attemptsLeft : settings.maxAttempts}
            </dd>
            <dt>Expires in</dt>
            <dd>{settings.offerTtlHours}h</dd>
          </dl>
          {canSubmit ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                Your offer (USD)
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  data-testid="listing-offer-amount-input"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Message (optional)
                <textarea
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  data-testid="listing-offer-message-input"
                />
              </label>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onSubmit()}
                data-testid="listing-offer-submit"
              >
                Submit offer
              </Button>
            </div>
          ) : (
            <p className="text-sm text-amber-700" data-testid="listing-offer-max-attempts">
              No offer attempts remaining on this listing.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600" data-testid="listing-offer-error">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-700" data-testid="listing-offer-success">
              {success}
            </p>
          )}
        </>
      )}
      {myOffers.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your offers</p>
          <ul className="space-y-2" data-testid="listing-offer-history">
            {myOffers.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-white/5"
                data-testid="listing-offer-history-item"
              >
                <span>
                  {o.amountDisplay} · {o.statusDisplay}
                </span>
                {['pending', 'countered'].includes(o.status) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onWithdraw(o)}
                    data-testid="listing-offer-withdraw"
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Link href="/offers/sent" className="text-xs text-brand hover:underline">
            View all sent offers
          </Link>
        </div>
      )}
    </Card>
    </div>
  )
}
