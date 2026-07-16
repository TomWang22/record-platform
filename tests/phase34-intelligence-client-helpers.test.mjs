import assert from 'node:assert/strict'
import test from 'node:test'

function confidenceScore(confidence) {
  if (typeof confidence === 'number' && Number.isFinite(confidence)) return confidence
  if (confidence && typeof confidence === 'object' && typeof confidence.score === 'number') {
    return confidence.score
  }
  return null
}

function limitationMessages(limitations) {
  if (!Array.isArray(limitations)) return []
  return limitations.map((l) => l.message || l.code).filter(Boolean)
}

function isAbstentionResult(result) {
  if (!result) return true
  if (result.scarcity_label === 'insufficient_data') return true
  return (result.limitations || []).some(
    (l) => l.severity === 'blocking' || /ABSTAIN|INSUFFICIENT/i.test(l.code || ''),
  )
}

test('confidenceScore reads number or object.score', () => {
  assert.equal(confidenceScore(0.42), 0.42)
  assert.equal(confidenceScore({ score: 0.8 }), 0.8)
  assert.equal(confidenceScore(undefined), null)
})

test('isAbstentionResult detects insufficient_data and blocking limitations', () => {
  assert.equal(isAbstentionResult({ scarcity_label: 'insufficient_data', limitations: [] }), true)
  assert.equal(
    isAbstentionResult({
      scarcity_label: 'rare',
      limitations: [{ code: 'ABSTAINED', message: 'weak', severity: 'blocking' }],
    }),
    true,
  )
  assert.equal(
    isAbstentionResult({
      scarcity_label: 'common',
      limitations: [{ code: 'NOTE', message: 'ok', severity: 'info' }],
    }),
    false,
  )
})

test('limitationMessages extracts human text', () => {
  assert.deepEqual(
    limitationMessages([{ code: 'A', message: 'first' }, { code: 'B', message: '' }]),
    ['first', 'B'],
  )
})
