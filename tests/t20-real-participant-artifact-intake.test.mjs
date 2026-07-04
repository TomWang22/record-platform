import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const toolPath = path.join(repoRoot, 'scripts/t20-real-participant-artifact-intake.mjs')
const sourceArtifact = path.join(
  repoRoot,
  'docs/ai-platform/T20-35-owner-approved-real-preview-participants.md',
)

const validRows = [
  {
    email: 'owner-approved-a@example.com',
    uuid: '11111111-1111-4111-8111-111111111111',
    participantType: 'real_owner_approved',
    approvalSource: 'Owner approval reference for participant A - 2026-07-03',
    consentConfirmed: 'yes',
    signature: 'Tom Wang / repository owner - 2026-07-03',
  },
  {
    email: 'owner-approved-b@example.com',
    uuid: '22222222-2222-4222-8222-222222222222',
    participantType: 'internal_staff',
    approvalSource: 'Owner approval reference for participant B - 2026-07-03',
    consentConfirmed: 'yes',
    signature: 'Tom Wang / repository owner - 2026-07-03',
  },
]

function participantRowCount(markdown) {
  return (markdown.match(/^\| \d+ \| [^|]+@/gm) ?? []).length
}

function withArtifactCopy(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 't20-intake-'))
  const artifact = path.join(dir, 'participants.md')
  writeFileSync(artifact, readFileSync(sourceArtifact, 'utf8'))
  try {
    return fn({ dir, artifact })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runTool(args, env = {}) {
  return spawnSync(process.execPath, [toolPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function writeInput(dir, rows) {
  const input = path.join(dir, 'participants.json')
  writeFileSync(input, JSON.stringify(rows, null, 2))
  return input
}

function expectRejected(row, expectedText) {
  withArtifactCopy(({ dir, artifact }) => {
    const before = readFileSync(artifact, 'utf8')
    const input = writeInput(dir, [row])
    const result = runTool(['--artifact', artifact, '--input', input, '--write'])
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, expectedText)
    assert.equal(readFileSync(artifact, 'utf8'), before)
  })
}

test('valid two-row append writes N=5 artifact', () => {
  withArtifactCopy(({ dir, artifact }) => {
    const input = writeInput(dir, validRows)
    const result = runTool(['--artifact', artifact, '--input', input, '--write'])

    assert.equal(result.status, 0, result.stderr)
    const updated = readFileSync(artifact, 'utf8')
    assert.equal(participantRowCount(updated), 5)
    assert.match(updated, /\| 4 \| owner-approved-a@example\.com \|/)
    assert.match(updated, /\| 5 \| owner-approved-b@example\.com \|/)
    assert.match(result.stdout, /Final participant count: 5/)
    assert.match(result.stdout, /SHA256: [0-9a-f]{64}/)
  })
})

test('rejects TBD email', () => {
  expectRejected({ ...validRows[0], email: 'TBD' }, /email/i)
})

test('rejects invalid UUID', () => {
  expectRejected({ ...validRows[0], uuid: 'not-a-uuid' }, /uuid/i)
})

test('rejects @record-platform.local email', () => {
  expectRejected({ ...validRows[0], email: 'person@record-platform.local' }, /staging|test/i)
})

test('rejects t20-* email', () => {
  expectRejected({ ...validRows[0], email: 't20-new@example.com' }, /staging|test/i)
})

test('rejects e2e-* email', () => {
  expectRejected({ ...validRows[0], email: 'e2e-new@example.com' }, /staging|test/i)
})

test('rejects duplicate UUID', () => {
  expectRejected(
    { ...validRows[0], uuid: '0dc268d0-a86f-4e12-8d10-9db0f1b735e0' },
    /duplicate/i,
  )
})

test('rejects consent not yes', () => {
  expectRejected({ ...validRows[0], consentConfirmed: 'no' }, /consent/i)
})

test('rejects blank approvalSource', () => {
  expectRejected({ ...validRows[0], approvalSource: '   ' }, /approvalSource/i)
})

test('dry-run does not modify artifact', () => {
  withArtifactCopy(({ dir, artifact }) => {
    const before = readFileSync(artifact, 'utf8')
    const input = writeInput(dir, validRows)
    const result = runTool(['--artifact', artifact, '--input', input, '--dry-run'])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(artifact, 'utf8'), before)
    assert.match(result.stdout, /Mode: dry-run/)
    assert.match(result.stdout, /Final participant count: 5/)
  })
})

