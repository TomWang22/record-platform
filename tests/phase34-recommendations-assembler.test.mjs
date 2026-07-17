import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleRecommendationsRequest,
} from '../webapp/lib/ai-recommendations-assembler.ts'

test('recommendations preserve budget and negative preferences without pay-to-rank', () => {
  const request = assembleRecommendationsRequest({
    principalId: 'principal_a',
    candidates: [
      { id: 'kept', title: 'Allowed record', price: 30, currency: 'USD', tags: ['jazz'] },
      { id: 'excluded', title: 'Blocked record', price: 20, currency: 'USD', tags: ['bootleg'] },
      { id: 'over-budget', title: 'Expensive record', price: 90, currency: 'USD', tags: ['jazz'] },
    ],
    budget: { max: 50, currency: 'USD' },
    negativePreferences: ['bootleg'],
  })

  assert.equal(request.no_pay_to_rank, true)
  assert.equal(request.request_appreciation_prediction, false)
  assert.equal(request.budget.max, 50)
  assert.deepEqual(request.negative_preferences, ['bootleg'])
  assert.deepEqual(request.candidates.map((candidate) => candidate.entity_id), ['kept'])
  assert.deepEqual(request.candidates[0].reason_codes, ['within_budget', 'matched_preference'])
})

test('recommendations refuse candidates outside the requesting owner scope', () => {
  const request = assembleRecommendationsRequest({
    principalId: 'principal_a',
    candidates: [
      { id: 'mine', title: 'Authorized', price: 30, owner_scope: 'principal_a' },
      { id: 'other', title: 'Unauthorized', price: 30, owner_scope: 'principal_b' },
    ],
  })

  assert.equal(request.candidates.length, 1)
  assert.equal(request.candidates[0].entity_id, 'mine')
  assert.ok(request.limitations.some((limitation) => /owner scope/i.test(limitation)))
})
