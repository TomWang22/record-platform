import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Pure guards mirroring SearchIntelligenceChrome fallback policy.
 * Silent semantic→keyword success is forbidden.
 */

function classifyExecutedMode(selected, apiMode) {
  const actual = String(apiMode || selected)
  if (actual.includes('hybrid')) return 'hybrid'
  if (actual.includes('semantic')) return 'semantic'
  return 'keyword'
}

function shouldRejectSilentFallback(selected, executed) {
  if (selected === 'semantic' || selected === 'hybrid') {
    return executed === 'keyword'
  }
  return false
}

test('keyword remains selectable production default', () => {
  assert.equal(classifyExecutedMode('keyword', 'keyword'), 'keyword')
  assert.equal(shouldRejectSilentFallback('keyword', 'keyword'), false)
})

test('semantic success keeps semantic executed mode', () => {
  assert.equal(classifyExecutedMode('semantic', 'semantic'), 'semantic')
  assert.equal(shouldRejectSilentFallback('semantic', 'semantic'), false)
})

test('semantic path that returns keyword is visible failure not success', () => {
  const executed = classifyExecutedMode('semantic', 'keyword')
  assert.equal(executed, 'keyword')
  assert.equal(shouldRejectSilentFallback('semantic', executed), true)
})

test('hybrid path that returns keyword is visible failure', () => {
  const executed = classifyExecutedMode('hybrid', 'keyword')
  assert.equal(shouldRejectSilentFallback('hybrid', executed), true)
})
