'use client'

import { useMemo, useState } from 'react'

import { NegotiationIntelligencePanel } from '@/components/ai/intelligence/negotiation-intelligence-panel'
import { ValuationIntelligencePanel } from '@/components/ai/intelligence/valuation-intelligence-panel'
import { getClientSessionToken } from '@/lib/session'
import { getUserIdFromToken } from '@/lib/jwt-user'
import type { PublicOffer } from '@/lib/offers-api'
import type { CollectionRecord } from '@/lib/records-types'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

type OfferInboxIntelligenceProps = {
  offers: PublicOffer[]
}

/**
 * Offer-context intelligence: valuation ranges + negotiation strategy.
 * Insert never auto-sends; unauthorized threads abstain.
 */
export function OfferInboxIntelligence({ offers }: OfferInboxIntelligenceProps) {
  const session = useSession()
  const token = isSessionAuthenticated(session) ? session.token : getClientSessionToken()
  const currentUserId = getUserIdFromToken(token)
  const [draft, setDraft] = useState('')

  const valuationSubject = useMemo((): CollectionRecord | null => {
    const first = offers[0]
    if (!first) return null
    return {
      id: String(first.listingId || first.id || 'offer-context'),
      artist: first.listingTitle || 'Offer context',
      title: first.listingTitle || 'Offer listing',
      format: 'LP',
    } as CollectionRecord
  }, [offers])

  const askingPrice = useMemo(() => {
    const raw = offers[0]?.amountDisplay || ''
    const n = Number(String(raw).replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : null
  }, [offers])

  return (
    <div className="space-y-4" data-testid="offer-inbox-intelligence">
      <h2 className="text-lg font-semibold">Offer intelligence</h2>
      <p className="text-sm text-slate-500">
        Valuation context and negotiation assistance for inbox offers. Insert drafts into the
        composer — never auto-send.
      </p>
      {valuationSubject ? (
        <ValuationIntelligencePanel record={valuationSubject} advisoryOnly />
      ) : (
        <div
          data-testid="intelligence-valuation-panel-missing"
          className="rounded border border-dashed p-3 text-sm text-slate-500"
        >
          No offer selected for valuation context.
        </div>
      )}
      <NegotiationIntelligencePanel
        threadId={null}
        thread={null}
        currentUserId={currentUserId}
        askingPrice={askingPrice}
        onApplyDraft={(text) => setDraft(text)}
      />
      {draft ? (
        <p className="text-xs text-slate-500" data-testid="offer-inbox-draft-preview">
          Draft ready (not sent): {draft.slice(0, 120)}
        </p>
      ) : null}
    </div>
  )
}
