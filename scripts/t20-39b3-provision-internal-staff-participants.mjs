#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const OUT_PATH = 'bench_logs/ai-platform/t20-39b3/internal-staff-participants.json'
const DB_DIFF_PATH = 'bench_logs/ai-platform/t20-39b3/auth-users-db-diff.json'
const AUTH_URL = process.env.POSTGRES_URL_AUTH ?? 'postgresql://postgres:postgres@127.0.0.1:5437/auth'
const API_BASE = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
const LOGIN_PASSWORD = process.env.T20_PARTICIPANT_LOGIN_PASSWORD
const SEED_EMAILS = ['tom@example.com', 'tw5126@example.com', 'seed@example.com']
const CA_PATH = path.join(ROOT, 'certs/dev-chain.pem')

export const PARTICIPANTS = [
  {
    email: 'phase21-preview-internal-1@example.com',
    preferredUuid: '8f0f4a52-8e01-4f8f-9c31-1c3b3949d101',
    participantType: 'internal_staff',
    approvalSource:
      'Owner chat instruction approving T20.39B3 internal_staff participant provisioning for opt-in hybrid preview N=5 soak — 2026-07-03',
    consentConfirmed: 'yes',
    signature: 'Tom Wang / repository owner — 2026-07-03',
  },
  {
    email: 'phase21-preview-internal-2@example.com',
    preferredUuid: 'b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2',
    participantType: 'internal_staff',
    approvalSource:
      'Owner chat instruction approving T20.39B3 internal_staff participant provisioning for opt-in hybrid preview N=5 soak — 2026-07-03',
    consentConfirmed: 'yes',
    signature: 'Tom Wang / repository owner — 2026-07-03',
  },
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...options.env },
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  return result.stdout.trim()
}

export function assertSafeEmail(email) {
  const lower = String(email).toLowerCase()
  const rejected = [
    '@record-platform.local',
    't20-',
    'e2e-',
    '-contract',
    'auth-test-',
    'microservice-test-',
    'test-',
    'k6-',
    'benchmark',
    'playwright',
    'disposable',
    'generated',
  ]

  for (const token of rejected) {
    if (lower.includes(token)) {
      throw new Error(`Rejected unsafe participant email: ${email}`)
    }
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    throw new Error(`Invalid participant email: ${email}`)
  }
}

export function buildIntakeRows(rows) {
  return rows.map((row) => {
    assertSafeEmail(row.email)
    if (!row.uuid) throw new Error(`Missing UUID for ${row.email}`)
    return {
      email: row.email,
      uuid: row.uuid,
      participantType: 'internal_staff',
      approvalSource: row.approvalSource,
      consentConfirmed: 'yes',
      signature: row.signature,
    }
  })
}

export function diffRows(beforeRows, afterRows) {
  const before = new Map(beforeRows.map((row) => [row.email.toLowerCase(), row.uuid]))
  const created = []
  const reused = []
  for (const row of afterRows) {
    const prior = before.get(row.email.toLowerCase())
    if (!prior) created.push(row.email)
    else if (prior === row.uuid) reused.push(row.email)
  }
  return { created, reused }
}

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT_PATH)), { recursive: true })
}

function targetEmails() {
  return PARTICIPANTS.map((participant) => participant.email)
}

function redactedAuthUrl() {
  return AUTH_URL.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@')
}

async function selectTargetRows(client) {
  const result = await client.query(
    `SELECT email::text, id::text AS uuid
     FROM auth.users
     WHERE lower(email::text) = ANY($1::text[])
     ORDER BY email::text`,
    [targetEmails().map((email) => email.toLowerCase())],
  )
  return result.rows.map((row) => ({ email: row.email, uuid: row.uuid }))
}

async function selectSeedPasswordHash(client) {
  const result = await client.query(
    `SELECT password_hash
     FROM auth.users
     WHERE lower(email::text) = ANY($1::text[])
       AND password_hash IS NOT NULL
     ORDER BY CASE lower(email::text)
       WHEN 'tom@example.com' THEN 1
       WHEN 'tw5126@example.com' THEN 2
       WHEN 'seed@example.com' THEN 3
       ELSE 4
     END
     LIMIT 1`,
    [SEED_EMAILS],
  )
  const hash = result.rows[0]?.password_hash
  if (!hash) throw new Error('Could not resolve existing participant password hash')
  return hash
}

async function ensureParticipant(client, participant, passwordHash) {
  assertSafeEmail(participant.email)
  const existing = await client.query(
    `SELECT id::text AS uuid, email::text
     FROM auth.users
     WHERE lower(email::text) = lower($1)
     LIMIT 1`,
    [participant.email],
  )
  if (existing.rows[0]) {
    return { email: existing.rows[0].email, uuid: existing.rows[0].uuid, action: 'reused' }
  }

  const conflictingUuid = await client.query(
    `SELECT email::text
     FROM auth.users
     WHERE id = $1::uuid
     LIMIT 1`,
    [participant.preferredUuid],
  )
  if (conflictingUuid.rows[0]) {
    throw new Error(
      `Preferred UUID for ${participant.email} is already used by ${conflictingUuid.rows[0].email}`,
    )
  }

  const inserted = await client.query(
    `INSERT INTO auth.users (
       id, email, password_hash, settings, created_at, updated_at,
       email_verified, phone_verified, mfa_enabled, is_deleted,
       username, display_username
     )
     VALUES (
       $1::uuid, $2::citext, $3, '{}'::jsonb, NOW(), NOW(),
       false, false, false, false,
       split_part($2::text, '@', 1), split_part($2::text, '@', 1)
     )
     RETURNING email::text, id::text AS uuid`,
    [participant.preferredUuid, participant.email, passwordHash],
  )
  return { email: inserted.rows[0].email, uuid: inserted.rows[0].uuid, action: 'created' }
}

function requestJson(url, body) {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const client = isHttps ? https : http
  const payload = JSON.stringify(body)
  const ca = isHttps && fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH) : undefined

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        ca,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-RP-E2E-Contract': '1',
        },
        timeout: 60_000,
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new Error(`Login failed with HTTP ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch (error) {
            reject(new Error(`Login response JSON parse failed: ${error.message}`))
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('Login request timed out'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function jwtSub(token) {
  const parts = String(token).split('.')
  if (parts.length < 2) throw new Error('Login response token is not a JWT')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  return String(payload.sub)
}

function invalidateAuthCache(email) {
  try {
    run('docker', [
      'exec',
      'record-platform-redis-1',
      'redis-cli',
      'DEL',
      `auth:user:${email}`,
      `auth:login:${email}`,
      `user:${email}`,
    ])
  } catch {
    // Redis cache keys are best-effort only; login verification remains the gate.
  }
}

async function verifyLogin(email, uuid) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await requestJson(`${API_BASE}/api/auth/login`, {
        email,
        password: LOGIN_PASSWORD,
      })
      const token = response.token
      const sub = jwtSub(token)
      if (sub !== uuid) throw new Error(`JWT sub mismatch for ${email}: ${sub}`)
      return { email, uuid, jwtSub: sub, status: 'PASS' }
    } catch (error) {
      if (attempt === 1) {
        invalidateAuthCache(email)
        continue
      }
      throw error
    }
  }
  throw new Error(`JWT verification failed for ${email}`)
}

async function cleanupInsertedRows(client, rows) {
  if (rows.length === 0) return
  await client.query(
    `DELETE FROM auth.users
     WHERE lower(email::text) = ANY($1::text[])`,
    [rows.map((row) => row.email.toLowerCase())],
  )
}

function hashRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

async function main() {
  for (const participant of PARTICIPANTS) assertSafeEmail(participant.email)
  if (!LOGIN_PASSWORD) {
    throw new Error('Set T20_PARTICIPANT_LOGIN_PASSWORD before provisioning participants')
  }
  ensureOutputDir()

  const pool = new pg.Pool({ connectionString: AUTH_URL })
  const client = await pool.connect()
  const createdRows = []
  try {
    const beforeRows = await selectTargetRows(client)
    const passwordHash = await selectSeedPasswordHash(client)
    const provisioned = []

    for (const participant of PARTICIPANTS) {
      const row = await ensureParticipant(client, participant, passwordHash)
      provisioned.push({ ...participant, uuid: row.uuid, action: row.action })
      if (row.action === 'created') createdRows.push(row)
    }

    const afterRows = await selectTargetRows(client)
    const diff = diffRows(beforeRows, afterRows)

    try {
      const jwtChecks = []
      for (const row of provisioned) {
        jwtChecks.push(await verifyLogin(row.email, row.uuid))
      }

      const intakeRows = buildIntakeRows(provisioned)
      fs.writeFileSync(path.join(ROOT, OUT_PATH), `${JSON.stringify(intakeRows, null, 2)}\n`)
      fs.writeFileSync(
        path.join(ROOT, DB_DIFF_PATH),
        `${JSON.stringify(
          {
            authUrl: redactedAuthUrl(),
            beforeCount: beforeRows.length,
            afterCount: afterRows.length,
            beforeHash: hashRows(beforeRows),
            afterHash: hashRows(afterRows),
            diff,
            rows: afterRows,
            jwtChecks,
          },
          null,
          2,
        )}\n`,
      )

      console.log(`Wrote ${OUT_PATH}`)
      console.log(`Wrote ${DB_DIFF_PATH}`)
      console.log(`DB diff: created=${diff.created.length}, reused=${diff.reused.length}`)
      console.log('JWT sub verification: PASS 2/2')
    } catch (error) {
      await cleanupInsertedRows(client, createdRows)
      throw new Error(
        `JWT verification failed; cleaned up ${createdRows.length} newly inserted participant row(s). ${error.message}`,
      )
    }
  } finally {
    client.release()
    await pool.end()
  }
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

