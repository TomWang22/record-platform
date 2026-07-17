import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('intelligence panel shell has exactly one score declaration', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'webapp/components/ai/intelligence/intelligence-panel-shell.tsx'),
    'utf8',
  )
  const matches = src.match(/const score = confidenceScore\(/g) || []
  assert.equal(matches.length, 1)
})

test('phase34 client matrix uses only allowed statuses and never PRODUCT_SLICE_ACCEPTED yet', () => {
  const matrix = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'scripts/ai-platform/phase34-client-surface-matrix.json'), 'utf8'),
  )
  const allowed = new Set(matrix.allowed_statuses)
  assert.ok(allowed.has('INTEGRATION_TESTED'))
  assert.ok(allowed.has('PRODUCT_SLICE_ACCEPTED'))
  for (const surface of matrix.surfaces) {
    assert.ok(allowed.has(surface.status), `${surface.capability}/${surface.surface}: ${surface.status}`)
    assert.notEqual(surface.status, 'PRODUCT_SLICE_ACCEPTED')
  }
  const caps = new Set(matrix.surfaces.map((s) => s.capability))
  for (const required of [
    'scarcity',
    'valuation',
    'auction',
    'search',
    'negotiation',
    'recommendations',
    'market_analytics',
    'embedding_lineage',
    'memory',
  ]) {
    assert.ok(caps.has(required), `missing capability ${required}`)
  }
})

test('all eight intelligence client entrypoints are exported', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'webapp/lib/ai-intelligence-client.ts'), 'utf8')
  for (const name of [
    'fetchScarcityIntelligence',
    'fetchValuationIntelligence',
    'fetchAuctionIntelligence',
    'fetchWatchlistTemperature',
    'fetchNegotiationAssistance',
    'fetchRecommendationsIntelligence',
    'fetchMarketAnalyticsIntelligence',
    'fetchEmbeddingMetadata',
    'fetchSemanticSearchIntelligence',
    'resolveIntelligenceMemory',
    'forgetIntelligenceMemory',
  ]) {
    assert.match(src, new RegExp(`export async function ${name}`))
  }
})

test('automatic_send_allowed remains forced false in negotiation client', () => {
  const src = fs.readFileSync(path.join(ROOT, 'webapp/lib/ai-intelligence-client.ts'), 'utf8')
  assert.match(src, /automatic_send_allowed:\s*false/)
})
