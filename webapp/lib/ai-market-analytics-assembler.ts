export type MarketAnalyticsEventInput = {
  evidence_id: string
  sale_kind: 'sold' | 'asking'
  price: number
  currency: string
  deletion_state: 'ACTIVE' | 'DELETED'
  owner_principal_fixture?: string
  [key: string]: unknown
}

export type MarketAnalyticsAssemblyInput = {
  principalId: string
  currency: string
  timeRange?: { start: string; end: string; timezone: string }
  events: MarketAnalyticsEventInput[]
  subject?: Record<string, unknown>
}

export const MARKET_ANALYTICS_ASSEMBLER_VERSION = 'phase34b-market-analytics-v1'

const REQUIRED_DISPLAY_FIELDS = [
  'time_range',
  'population',
  'sample_size',
  'currency',
  'methodology',
  'freshness',
  'limitations',
] as const

export function assembleMarketAnalyticsRequest(input: MarketAnalyticsAssemblyInput) {
  const limitations: string[] = []
  const currency = input.currency.toUpperCase()
  const events = input.events.flatMap((event) => {
    if (event.deletion_state !== 'ACTIVE') {
      limitations.push(`Excluded ${event.evidence_id}: deleted evidence.`)
      return []
    }
    if (event.sale_kind !== 'sold') {
      limitations.push(`Excluded ${event.evidence_id}: asking prices are not sold events.`)
      return []
    }
    if (event.currency.toUpperCase() !== currency) {
      limitations.push(`Excluded ${event.evidence_id}: currency differs from ${currency}.`)
      return []
    }
    if (event.owner_principal_fixture && event.owner_principal_fixture !== input.principalId) {
      limitations.push(`Excluded ${event.evidence_id}: event is outside the requesting owner scope.`)
      return []
    }
    return [event]
  })

  return {
    requesting_principal_fixture: input.principalId,
    principal_id: input.principalId,
    analytics_mode: 'release_market_summary',
    subject: input.subject || {},
    currency,
    time_range: input.timeRange || null,
    events,
    min_sample: 1,
    request_causal_claim: false,
    request_future_price_prediction: false,
    required_display_fields: [...REQUIRED_DISPLAY_FIELDS],
    authorized_scopes: ['authenticated_market', 'owner_private'],
    limitations,
    assembler_version: MARKET_ANALYTICS_ASSEMBLER_VERSION,
  }
}
