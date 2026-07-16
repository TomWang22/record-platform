#!/usr/bin/env node
/**
 * Phase 33F — unauthorized_thread reproduction matrix (diagnostic; not canary-v1).
 * Writes under /tmp/phase33f-negotiation-unauthorized-thread-repro-v1
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { curlRequest, PROTOCOLS, DEFAULTS, login } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = '/tmp/phase33f-negotiation-unauthorized-thread-repro-v1';
const ENDPOINT = '/api/ai/intelligence/negotiation';

function bodyFor(seed, extra = {}) {
  return {
    capability: 'negotiation_assistance',
    mode: 'unauthorized_thread',
    capability_mode: 'unauthorized_thread',
    fixture_band: 'development',
    retrieval_mode: 'keyword_metadata',
    schema_version: 'phase33f-negotiation_assistance-1',
    principal_fixture: 'principal_a',
    participant_side: 'buyer',
    authorization_scopes: ['authenticated_market', 'owner_private_fixture'],
    prohibited_scopes: ['cross_user_private', 'production_write'],
    conversation_or_session_id: null,
    turns: 1,
    memory_classes: ['conversation_only'],
    seed,
    production_mutation_allowed: false,
    ...extra,
  };
}

function issue(protocol, token, userId, seed, extra = {}) {
  const body = bodyFor(seed, extra);
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const started = Date.now();
  const result = curlRequest({
    method: 'POST',
    urlPath: ENDPOINT,
    token,
    userId,
    body,
    protocol: PROTOCOLS[protocol],
    caCert: path.join(REPO_ROOT, 'certs/dev-chain.pem'),
    baseUrl: DEFAULTS.baseUrl,
  });
  return {
    protocol,
    seed,
    request_sha256: crypto.createHash('sha256').update(bodyBytes).digest('hex'),
    http_status: result.http_status,
    http_version: result.http_version,
    ok: result.http_status === 200 && result.body?.diagnostics?.unauthorized_thread === true,
    engine_invoked: result.body?.diagnostics?.engine_invoked,
    detail: result.body?.detail || null,
    unauthorized: result.body?.diagnostics?.unauthorized_thread ?? null,
    duration_ms: Date.now() - started,
  };
}

function summarize(rows, label) {
  const unexpected422 = rows.filter(
    (r) =>
      r.http_status === 422 &&
      (r.detail === 'phase33d_engine_failed' ||
        r.detail === 'ENGINE_INTERNAL_FAILURE' ||
        (typeof r.detail === 'string' && r.detail.includes('phase33d'))),
  ).length;
  const engineFail = rows.filter(
    (r) =>
      r.detail === 'ENGINE_INTERNAL_FAILURE' ||
      r.detail === 'phase33d_engine_failed' ||
      r.http_status === 500,
  ).length;
  const pass = rows.filter((r) => r.ok).length;
  return {
    label,
    total: rows.length,
    pass,
    unexpected_422: unexpected422,
    engine_internal_or_legacy_fail: engineFail,
    status_counts: rows.reduce((acc, r) => {
      acc[String(r.http_status)] = (acc[String(r.http_status)] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const email =
    process.env.PHASE33F_REPRO_EMAIL ||
    spawnSync('bash', ['-lc', `kubectl -n record-platform get secret e2e-contract-credentials -o jsonpath='{.data.email}' 2>/dev/null | base64 -d`], {
      encoding: 'utf8',
    }).stdout.trim() ||
    'e2e-contract@record-platform.local';
  const password = process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!';
  const token = login(email, { password, baseUrl: DEFAULTS.baseUrl, caCert: path.join(REPO_ROOT, 'certs/dev-chain.pem') });
  const userId = 'principal_a';

  const report = { at: new Date().toISOString(), out: OUT, sections: {} };

  // A. Sequential single-protocol
  for (const proto of ['h1', 'h2', 'h3']) {
    const rows = [];
    for (let i = 0; i < 30; i += 1) {
      rows.push(issue(proto, token, userId, 40000 + i));
    }
    report.sections[`sequential_${proto}`] = summarize(rows, `sequential_${proto}`);
    fs.writeFileSync(path.join(OUT, `sequential-${proto}.json`), JSON.stringify(rows, null, 2));
  }

  // B. Synchronized triplets (30)
  const triplets = [];
  for (let i = 0; i < 30; i += 1) {
    const seedBase = 50000 + i * 3;
    const started = Date.now();
    // Fire nearly together via sequential calls still close in time; true parallel via Promise
    const [h1, h2, h3] = await Promise.all([
      Promise.resolve(issue('h1', token, userId, seedBase)),
      Promise.resolve(issue('h2', token, userId, seedBase + 1)),
      Promise.resolve(issue('h3', token, userId, seedBase + 2)),
    ]);
    triplets.push({ i, spread_ms: Date.now() - started, h1, h2, h3, parity: h1.http_status === h2.http_status && h2.http_status === h3.http_status && h1.ok && h2.ok && h3.ok });
  }
  report.sections.synchronized_triplets = {
    ...summarize(triplets.flatMap((t) => [t.h1, t.h2, t.h3]), 'triplets'),
    parity_batches: triplets.filter((t) => t.parity).length,
    total_batches: triplets.length,
  };
  fs.writeFileSync(path.join(OUT, 'synchronized-triplets.json'), JSON.stringify(triplets, null, 2));

  // C. Order permutations (10 each)
  const orders = [
    ['h1', 'h2', 'h3'],
    ['h2', 'h3', 'h1'],
    ['h3', 'h1', 'h2'],
  ];
  for (const order of orders) {
    const rows = [];
    for (let i = 0; i < 10; i += 1) {
      for (const p of order) {
        rows.push(issue(p, token, userId, 60000 + i));
      }
    }
    const key = `order_${order.join('_')}`;
    report.sections[key] = summarize(rows, key);
  }

  // E. Controls
  const controls = {
    authorized: issue('h2', token, userId, 70001, {
      mode: 'baseline',
      capability_mode: 'baseline',
      authorized_thread_id: 't-auth',
      thread: { thread_id: 't-auth', participant_principals: ['principal_a', 'seller_b'] },
      requesting_principal_fixture: 'principal_a',
      subject: { listing_id: 'L1', release_id: 'r1' },
      market_candidates: [],
    }),
    missing_thread: issue('h2', token, userId, 70002, { mode: 'missing_thread', capability_mode: 'missing_thread' }),
    malformed: issue('h1', token, userId, 70003, { mode: 'unauthorized_thread', subject: 'not-an-object' }),
  };
  report.sections.controls = controls;

  const allUnexpected = Object.values(report.sections)
    .filter((s) => s && typeof s.unexpected_422 === 'number')
    .reduce((n, s) => n + s.unexpected_422, 0);
  report.classification =
    allUnexpected === 0 && report.sections.synchronized_triplets.parity_batches === 30
      ? 'CONTRACT_FIXED'
      : allUnexpected > 0
        ? 'STILL_FAILING'
        : 'PARTIAL';
  report.unexpected_422_total = allUnexpected;
  fs.writeFileSync(path.join(OUT, 'repro-summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.classification !== 'CONTRACT_FIXED') process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
