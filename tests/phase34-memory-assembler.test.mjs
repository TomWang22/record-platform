import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleMemoryRequest,
  buildMemoryCorrection,
} from '../webapp/lib/ai-memory-assembler.ts'

test('memory request remains scoped to the active user and thread', () => {
  const request = assembleMemoryRequest({
    principalId: 'principal_a',
    threadId: 'thread_1',
    memoryItems: [
      {
        memory_id: 'mine',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 40 },
        source_turn_ids: ['turn_1'],
        deletion_state: 'ACTIVE',
      },
      {
        memory_id: 'other-thread',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_2' },
        fact_key: 'budget',
        content: { value: 30 },
        source_turn_ids: ['turn_2'],
        deletion_state: 'ACTIVE',
      },
    ],
  })

  assert.equal(request.operation, 'resolve')
  assert.equal(request.thread_id, 'thread_1')
  assert.equal(request.memory_items.length, 1)
  assert.equal(request.memory_items[0].memory_id, 'mine')
  assert.equal(request.allow_durable_write, false)
  assert.ok(request.isolation_notice.includes('thread_1'))
})

test('memory correction supersedes a fact without creating a durable write', () => {
  const correction = buildMemoryCorrection({
    principalId: 'principal_a',
    threadId: 'thread_1',
    memoryId: 'budget',
    factKey: 'budget',
    value: '32',
  })

  assert.equal(correction.memory_class, 'session')
  assert.equal(correction.deletion_state, 'ACTIVE')
  assert.equal(correction.content.value, '32')
  assert.equal(correction.durable_consent, false)
  assert.equal(correction.source_label, 'user_correction')
})
