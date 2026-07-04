import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PARTICIPANTS,
  assertSafeEmail,
  buildIntakeRows,
  diffRows,
} from '../scripts/t20-39b3-provision-internal-staff-participants.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const sourceArtifact = path.join(
  repoRoot,
  'docs/ai-platform/T20-35-owner-approved-real-preview-participants.md',
)
const intakeTool = path.join(repoRoot, 'scripts/t20-real-participant-artifact-intake.mjs')

function n3ArtifactFixture() {
  return readFileSync(sourceArtifact, 'utf8')
    .replace(
      '**Status:** OWNER ARTIFACT — **complete** (5 owner-approved participants)',
      '**Status:** OWNER ARTIFACT — **complete** (3 owner-approved participants)',
    )
    .replace(
      /\| 4 \| phase21-preview-internal-1@example\.com \|[^\n]+\n\| 5 \| phase21-preview-internal-2@example\.com \|[^\n]+\n/,
      '',
    )
    .replace('At least **5** participants', 'At least **3** participants')
}

test('safe email accepts owner-approved internal staff participant address', () => {
  assert.doesNotThrow(() => assertSafeEmail('phase21-preview-internal-1@example.com'))
})

for (const email of [
  'person@record-platform.local',
  't20-person@example.com',
  'e2e-person@example.com',
  'person-contract@example.com',
  'auth-test-person@example.com',
  'microservice-test-person@example.com',
  'k6-person@example.com',
]) {
  test(`safe email rejects ${email}`, () => {
    assert.throws(() => assertSafeEmail(email), /Rejected unsafe participant email/)
  })
}

test('output rows use internal_staff and consent yes', () => {
  const rows = buildIntakeRows([
    { ...PARTICIPANTS[0], uuid: '8f0f4a52-8e01-4f8f-9c31-1c3b3949d101' },
    { ...PARTICIPANTS[1], uuid: 'b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2' },
  ])

  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.equal(row.participantType, 'internal_staff')
    assert.equal(row.consentConfirmed, 'yes')
  }
})

test('db diff reports created and reused participants without exposing secrets', () => {
  const before = [{ email: 'phase21-preview-internal-1@example.com', uuid: 'old-id' }]
  const after = [
    { email: 'phase21-preview-internal-1@example.com', uuid: 'old-id' },
    { email: 'phase21-preview-internal-2@example.com', uuid: 'new-id' },
  ]
  const diff = diffRows(before, after)

  assert.deepEqual(diff.reused, ['phase21-preview-internal-1@example.com'])
  assert.deepEqual(diff.created, ['phase21-preview-internal-2@example.com'])
  assert.equal(JSON.stringify(diff).includes('password'), false)
  assert.equal(JSON.stringify(diff).includes('token'), false)
})

test('output rows include hard-stop NO fields after intake append', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't20-b3-intake-'))
  try {
    const artifact = path.join(dir, 'participants.md')
    const input = path.join(dir, 'participants.json')
    writeFileSync(artifact, n3ArtifactFixture())
    writeFileSync(
      input,
      JSON.stringify(
        buildIntakeRows([
          { ...PARTICIPANTS[0], uuid: '8f0f4a52-8e01-4f8f-9c31-1c3b3949d101' },
          { ...PARTICIPANTS[1], uuid: 'b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2' },
        ]),
      ),
    )

    const result = spawnSync(
      process.execPath,
      [intakeTool, '--artifact', artifact, '--input', input, '--write'],
      { cwd: repoRoot, encoding: 'utf8' },
    )

    assert.equal(result.status, 0, result.stderr)
    const updated = readFileSync(artifact, 'utf8')
    assert.match(updated, /\| 4 \| phase21-preview-internal-1@example\.com \| .* \| internal_staff \| .* \| yes \| opt-in preview soak only \| NO \| NO \| NO \|/)
    assert.match(updated, /\| 5 \| phase21-preview-internal-2@example\.com \| .* \| internal_staff \| .* \| yes \| opt-in preview soak only \| NO \| NO \| NO \|/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

