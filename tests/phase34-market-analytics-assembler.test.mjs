import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleMarketAnalyticsRequest,
} from '../webapp/lib/ai-market-analytics-assembler.ts'

test('market analytics preserves metadata and excludes asking prices from sold events', () => {
  const request = assembleMarketAnalyticsRequest({
    principalId: 'principal_a',
    currency: 'USD',
    timeRange: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-07-01T00:00:00.000Z',
      timezone: 'UTC',
    },
    events: [
      { evidence_id: 'sold', sale_kind: 'sold', price: 35, currency: 'USD', deletion_state: 'ACTIVE' },
      { evidence_id: 'asking', sale_kind: 'asking', price: 50, currency: 'USD', deletion_state: 'ACTIVE' },
      { evidence_id: 'deleted', sale_kind: 'sold', price: 99, currency: 'USD', deletion_state: 'DELETED' },
    ],
  })

  assert.equal(request.analytics_mode, 'release_market_summary')
  assert.equal(request.request_causal_claim, false)
  assert.equal(request.request_future_price_prediction, false)
  assert.equal(request.events.length, 1)
  assert.equal(request.events[0].evidence_id, 'sold')
  assert.deepEqual(request.required_display_fields, [
    'time_range',
    'population',
    'sample_size',
    'currency',
    'methodology',
    'freshness',
    'limitations',
  ])
})

test('market analytics refuses mixed currencies and foreign owner data', () => {
  const request = assembleMarketAnalyticsRequest({
    principalId: 'principal_a',
    currency: 'USD',
    events: [
      { evidence_id: 'eur', sale_kind: 'sold', price: 35, currency: 'EUR', deletion_state: 'ACTIVE' },
      {
        evidence_id: 'other-owner',
        sale_kind: 'sold',
        price: 40,
        currency: 'USD',
        deletion_state: 'ACTIVE',
        owner_principal_fixture: 'principal_b',
      },
    ],
  })

  assert.equal(request.events.length, 0)
  assert.ok(request.limitations.some((limitation) => /currency/i.test(limitation)))
  assert.ok(request.limitations.some((limitation) => /owner scope/i.test(limitation)))
})
