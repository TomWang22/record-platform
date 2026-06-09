'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  closeAuction,
  dollarsToCents,
  fetchAuctionBids,
  fetchAuctionState,
  placeAuctionBid,
  type AuctionBidItem,
  type AuctionState,
} from '@/lib/auctions-api'

type Props = {
  listingId: string
  canClose?: boolean
}

export function ListingAuctionPanel({ listingId, canClose }: Props) {
  const [state, setState] = useState<AuctionState | null>(null)
  const [bids, setBids] = useState<AuctionBidItem[]>([])
  const [amount, setAmount] = useState('')
  const [useProxy, setUseProxy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [s, b] = await Promise.all([fetchAuctionState(listingId), fetchAuctionBids(listingId)])
    setState(s)
    setBids(b.items ?? [])
  }, [listingId])

  useEffect(() => {
    void reload().catch(() => setState(null))
  }, [reload])

  if (!state) return null

  const ended = state.status === 'ended'
  const canBid = !ended && state.viewerState !== 'won'

  async function onSubmit() {
    setError(null)
    setSuccess(null)
    const cents = dollarsToCents(amount)
    if (cents == null) {
      setError('Enter a valid bid amount.')
      return
    }
    setBusy(true)
    try {
      const next = await placeAuctionBid(listingId, {
        useProxy,
        ...(useProxy ? { maxBidCents: cents } : { amountCents: cents }),
      })
      setState(next)
      setSuccess(
        useProxy
          ? `Max bid submitted. Current bid: ${next.currentBidDisplay}`
          : `Bid placed: ${next.currentBidDisplay}`,
      )
      setAmount('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bid failed')
    } finally {
      setBusy(false)
    }
  }

  async function onClose() {
    setBusy(true)
    setError(null)
    try {
      const next = await closeAuction(listingId, true)
      setState(next)
      setSuccess('Auction closed.')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Close failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="listing-auction-panel">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Auction</p>
          <span
            className="text-xs font-medium uppercase tracking-wide text-slate-500"
            data-testid="listing-auction-status"
          >
            {state.status}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <dt>Current bid</dt>
          <dd data-testid="listing-auction-current-bid">{state.currentBidDisplay}</dd>
          <dt>Bids</dt>
          <dd data-testid="listing-auction-bid-count">{state.bidCount}</dd>
          <dt>Time left</dt>
          <dd data-testid="listing-auction-time-left">{state.timeLeft}</dd>
          <dt>Reserve</dt>
          <dd data-testid="listing-auction-reserve-met">{state.reserveMet ? 'Met' : 'Not met'}</dd>
          {state.highBidderMasked && (
            <>
              <dt>High bidder</dt>
              <dd data-testid="listing-auction-high-bidder">{state.highBidderMasked}</dd>
            </>
          )}
          {state.viewerState && (
            <>
              <dt>Your status</dt>
              <dd data-testid="listing-auction-viewer-state">{state.viewerState}</dd>
            </>
          )}
        </dl>

        {canBid && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                data-testid="listing-auction-proxy-toggle"
              />
              Max bid (proxy)
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {useProxy ? 'Your max bid (USD)' : 'Your bid (USD)'}
              <input
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="listing-auction-bid-input"
              />
            </label>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void onSubmit()}
              data-testid="listing-auction-submit"
            >
              Place bid
            </Button>
          </div>
        )}

        {canClose && !ended && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onClose()}
            data-testid="listing-auction-close"
          >
            Close auction (contract)
          </Button>
        )}

        {error && (
          <p className="text-sm text-red-600" data-testid="listing-auction-error">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-emerald-700" data-testid="listing-auction-success">
            {success}
          </p>
        )}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="listing-auction-history-toggle"
        >
          {showHistory ? 'Hide bid history' : 'Bid history'}
        </Button>
        {showHistory && (
          <ul className="max-h-48 space-y-2 overflow-y-auto text-sm" data-testid="listing-auction-history">
            {bids.map((b) => (
              <li
                key={b.id}
                className="flex justify-between gap-2 rounded bg-slate-50 px-2 py-1 dark:bg-white/5"
                data-testid="listing-auction-history-item"
              >
                <span>{b.amountDisplay}</span>
                <span className="text-xs text-slate-500">
                  {b.bidderMasked} · {b.bidSourceDisplay}
                </span>
              </li>
            ))}
            {bids.length === 0 && (
              <li className="text-xs text-slate-500">No bids yet.</li>
            )}
          </ul>
        )}
      </Card>
    </div>
  )
}
