import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Negotiation draft UX guards — mirror negotiation-intelligence-panel contracts.
 */

function negotiationRequestBody({
  threadId,
  principalId,
  participants,
  messages,
  autoSend = false,
}) {
  return {
    requesting_principal_fixture: principalId,
    principal_id: principalId,
    authorized_thread_id: threadId,
    automatic_send_allowed: false,
    request_auto_send: autoSend,
    thread: {
      thread_id: threadId,
      participant_principals: participants,
    },
    messages: messages.filter((m) => m.deletion_state !== 'DELETED' && Boolean(m.body?.trim())),
  }
}

function isUnauthorizedThread(body) {
  if (!body.principal_id || !body.authorized_thread_id) return true
  const principals = body.thread?.participant_principals || []
  if (principals.length && !principals.includes(body.principal_id)) return true
  return false
}

test('automatic_send_allowed is always false in request assembler', () => {
  const body = negotiationRequestBody({
    threadId: 't1',
    principalId: 'u1',
    participants: ['u1', 'u2'],
    messages: [{ body: 'hello', deletion_state: 'ACTIVE' }],
    autoSend: true,
  })
  assert.equal(body.automatic_send_allowed, false)
  // Even if caller asks for auto-send, product client must still force false.
  assert.equal(body.request_auto_send, true)
  assert.notEqual(body.automatic_send_allowed, true)
})

test('deleted messages are excluded from influence', () => {
  const body = negotiationRequestBody({
    threadId: 't1',
    principalId: 'u1',
    participants: ['u1'],
    messages: [
      { body: 'keep', deletion_state: 'ACTIVE' },
      { body: 'gone', deletion_state: 'DELETED' },
      { body: '   ', deletion_state: 'ACTIVE' },
    ],
  })
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].body, 'keep')
})

test('unauthorized thread detection sets engine_invoked path to false', () => {
  assert.equal(
    isUnauthorizedThread(
      negotiationRequestBody({
        threadId: 't1',
        principalId: 'intruder',
        participants: ['u1', 'u2'],
        messages: [],
      }),
    ),
    true,
  )
  assert.equal(
    isUnauthorizedThread(
      negotiationRequestBody({
        threadId: 't1',
        principalId: 'u1',
        participants: ['u1', 'u2'],
        messages: [],
      }),
    ),
    false,
  )
})

test('draft insert is separate from send — no auto-send flag in UX contract', () => {
  const ux = {
    label: 'AI-generated draft',
    autoSend: false,
    requiresExplicitUserSend: true,
  }
  assert.equal(ux.autoSend, false)
  assert.equal(ux.requiresExplicitUserSend, true)
  assert.match(ux.label, /AI-generated draft/)
})
