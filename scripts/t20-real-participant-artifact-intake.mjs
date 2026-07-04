#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const defaultArtifact = path.join(
  repoRoot,
  'docs/ai-platform/T20-35-owner-approved-real-preview-participants.md',
)

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailRe = /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/
const allowedTypes = new Set(['real_owner_approved', 'internal_staff'])
const disallowedEmailPatterns = [
  /@record-platform\.local$/i,
  /^t20-/i,
  /^e2e-/i,
  /-contract@/i,
  /^auth-test-/i,
  /^microservice-test-/i,
  /^test-/i,
  /^k6-/i,
  /^benchmark/i,
  /^bench/i,
  /playwright/i,
  /disposable/i,
  /generated/i,
  /^social-comp-/i,
  /^load-test-/i,
  /^shopping-/i,
  /^forum-vote-/i,
  /^grpc-/i,
  /^mfa/i,
  /^delete-test-/i,
]

function fail(message) {
  throw new Error(message)
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function parseArgs(argv) {
  const out = {
    artifact: defaultArtifact,
    input: null,
    dryRun: false,
    write: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input') {
      out.input = argv[++i]
    } else if (arg === '--artifact') {
      out.artifact = argv[++i]
    } else if (arg === '--dry-run') {
      out.dryRun = true
    } else if (arg === '--write') {
      out.write = true
    } else {
      fail(`Unknown argument: ${arg}`)
    }
  }

  if (!out.dryRun && !out.write) fail('Choose exactly one mode: --dry-run or --write')
  if (out.dryRun && out.write) fail('Choose exactly one mode: --dry-run or --write')
  if (!out.input && !process.env.T20_REAL_PARTICIPANTS_JSON) {
    fail('Provide --input <path> or T20_REAL_PARTICIPANTS_JSON')
  }
  return out
}

function loadCandidates(inputPath) {
  const raw = inputPath
    ? readFileSync(inputPath, 'utf8')
    : process.env.T20_REAL_PARTICIPANTS_JSON
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(`Invalid participant JSON: ${error.message}`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail('Participant JSON must be a non-empty array')
  }
  return parsed
}

function parseMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseExistingRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => {
      const cells = parseMarkdownRow(line)
      return {
        index: Number(cells[0]),
        email: cells[1],
        uuid: String(cells[2] ?? '').replace(/`/g, ''),
        participantType: cells[3],
      }
    })
}

function requireCheckedBoxes(markdown) {
  const required = [
    '* [x] Real participant opt-in hybrid preview soak only',
    '* [x] Participants listed below have owner approval / consent for preview testing',
    '* [x] JWT-authenticated users only',
    '* [x] User-scoped opt-in enrollment only',
    '* [x] Keyword default unchanged for non-enrolled users',
    '* [x] `AI_RAG_HYBRID_CANARY_PERCENT=0`',
    '* [x] `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`',
    '* [x] Hybrid anchored Lane B only',
    '* [x] Keyword fallback retained',
    '* [x] Overlap anchors retained',
    '* [x] Revoke and rollback drill required after live eval',
    '* [x] Hybrid production default',
    '* [x] Vector production default',
    '* [x] Percentage rollout',
    '* [x] `AI_RAG_HYBRID_CANARY_PERCENT > 0`',
    '* [x] Permanent allowlist broadening',
    '* [x] Anonymous or guest hybrid access',
    '* [x] Message-body exposure',
    '* [x] Removal of keyword fallback',
    '* [x] Removal of overlap anchors',
    '* [x] Relabeling staging/test cohort users as real participants',
  ]
  for (const needle of required) {
    if (!markdown.includes(needle)) fail(`Required approval checkbox missing: ${needle}`)
  }
}

function cleanString(value, fieldName) {
  if (typeof value !== 'string') fail(`${fieldName} must be a string`)
  const trimmed = value.trim()
  if (!trimmed || /^tbd$/i.test(trimmed) || /^placeholder$/i.test(trimmed)) {
    fail(`${fieldName} is blank or TBD`)
  }
  if (/[|\n\r]/.test(trimmed)) fail(`${fieldName} cannot contain table delimiters or newlines`)
  return trimmed
}

function validateEmail(email) {
  const cleaned = cleanString(email, 'email').toLowerCase()
  if (
    cleaned === 'person@example.com' ||
    cleaned === 'example@example.com' ||
    cleaned === 'first.real.participant@example.com' ||
    cleaned === 'second.real.participant@example.com'
  ) {
    fail('email is a placeholder')
  }
  if (!emailRe.test(cleaned)) fail(`email is invalid: ${email}`)
  for (const pattern of disallowedEmailPatterns) {
    if (pattern.test(cleaned)) fail(`email is staging/test/disallowed: ${email}`)
  }
  return cleaned
}

function validateCandidate(candidate, existingEmails, existingUuids, pendingEmails, pendingUuids) {
  const email = validateEmail(candidate.email)
  const uuid = cleanString(candidate.uuid, 'uuid').toLowerCase()
  if (!uuidRe.test(uuid)) fail(`uuid is invalid: ${candidate.uuid}`)
  const participantType = cleanString(candidate.participantType, 'participantType')
  if (!allowedTypes.has(participantType)) {
    fail(`participantType must be real_owner_approved or internal_staff: ${participantType}`)
  }
  const approvalSource = cleanString(candidate.approvalSource, 'approvalSource')
  const consentConfirmed = cleanString(candidate.consentConfirmed, 'consentConfirmed')
  if (consentConfirmed !== 'yes') fail('consentConfirmed must be exactly yes')
  const signature = cleanString(candidate.signature, 'signature')

  if (existingEmails.has(email) || pendingEmails.has(email)) fail(`duplicate email: ${email}`)
  if (existingUuids.has(uuid) || pendingUuids.has(uuid)) fail(`duplicate uuid: ${uuid}`)

  pendingEmails.add(email)
  pendingUuids.add(uuid)
  return {
    email,
    uuid,
    participantType,
    approvalSource,
    consentConfirmed,
    signature,
  }
}

function renderParticipantRow(index, participant) {
  const approval = `${participant.approvalSource}; Signature: ${participant.signature}`
  return `| ${index} | ${participant.email} | \`${participant.uuid}\` | ${participant.participantType} | ${approval} | yes | opt-in preview soak only | NO | NO | NO |`
}

function updateStatusAndGate(markdown, count) {
  return markdown
    .replace(
      /\*\*Status:\*\* OWNER ARTIFACT — \*\*complete\*\* \(\d+ owner-approved participants\)/,
      `**Status:** OWNER ARTIFACT — **complete** (${count} owner-approved participants)`,
    )
    .replace(
      /At least \*\*\d+\*\* participants must be complete and marked `real_owner_approved` or owner-approved `internal_staff` before any live eval\./,
      `At least **${count}** participants must be complete and marked \`real_owner_approved\` or owner-approved \`internal_staff\` before any live eval.`,
    )
}

function appendParticipants(markdown, participants) {
  requireCheckedBoxes(markdown)
  const existingRows = parseExistingRows(markdown)
  if (existingRows.length === 0) fail('No existing participant rows found')

  const existingEmails = new Set(existingRows.map((row) => row.email.toLowerCase()))
  const existingUuids = new Set(existingRows.map((row) => row.uuid.toLowerCase()))
  const pendingEmails = new Set()
  const pendingUuids = new Set()
  const validated = participants.map((candidate) =>
    validateCandidate(candidate, existingEmails, existingUuids, pendingEmails, pendingUuids),
  )

  const lines = markdown.split('\n')
  let insertAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\| \d+ \|/.test(lines[i])) insertAt = i + 1
  }
  if (insertAt < 0) fail('Could not locate participant table')

  const startIndex = Math.max(...existingRows.map((row) => row.index)) + 1
  const newRows = validated.map((participant, offset) =>
    renderParticipantRow(startIndex + offset, participant),
  )
  lines.splice(insertAt, 0, ...newRows)
  const updated = updateStatusAndGate(lines.join('\n'), existingRows.length + validated.length)
  requireCheckedBoxes(updated)
  return {
    markdown: updated,
    added: validated.length,
    finalCount: existingRows.length + validated.length,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const candidates = loadCandidates(args.input)
  const original = readFileSync(args.artifact, 'utf8')
  const result = appendParticipants(original, candidates)
  const hash = sha256(result.markdown)

  if (args.write) writeFileSync(args.artifact, result.markdown)

  console.log(`Mode: ${args.write ? 'write' : 'dry-run'}`)
  console.log(`Artifact: ${args.artifact}`)
  console.log(`Added participants: ${result.added}`)
  console.log(`Final participant count: ${result.finalCount}`)
  console.log(`SHA256: ${hash}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

