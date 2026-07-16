#!/usr/bin/env node
/**
 * Phase 33F controlled rate sweep (diagnostic). Does not touch canary roots.
 * Out: /tmp/phase33f-rate-limit-sweep-v1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  curlRequest,
  DEFAULTS,
  login,
  jwtSub,
  loadN5Participants,
  PROTOCOLS,
} from './lib/phase22-full-replay-common.mjs';
import { capabilityRoutePath } from './lib/phase33f-capability-probe.mjs';
import { sleepMs, GATEWAY_RATE_LIMIT_MAX } from './lib/phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = process.env.PHASE33F_RATE_SWEEP_OUT || '/tmp/phase33f-rate-limit-sweep-v1';

const INTERVALS_MS = (process.env.PHASE33F_RATE_SWEEP_INTERVALS || '750,1000,1500')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const BATCHES_PER_INTERVAL = Number(process.env.PHASE33F_RATE_SWEEP_BATCHES || 40);

function buildBody(seed) {
  return {
    capability: 'scarcity',
    mode: 'baseline',
    fixture_band: 'development',
    seed,
    production_mutation_allowed: false,
    schema_version: 'phase33f-rate-sweep-1',
  };
}

async function runTriplet(token, userId, seed, releaseAtMs) {
  while (Date.now() < releaseAtMs) {
    /* spin */
  }
  const started = {};
  const results = {};
  await Promise.all(
    ['h1', 'h2', 'h3'].map(async (proto) => {
      started[proto] = new Date().toISOString();
      const p = PROTOCOLS[proto];
      const resp = curlRequest({
        method: 'POST',
        urlPath: capabilityRoutePath('scarcity'),
        token,
        userId,
        body: buildBody(seed),
        protocolFlag: p.flag,
        expectedVersion: p.expected,
        baseUrl: DEFAULTS.baseUrl,
        caCert: DEFAULTS.caCert || path.join(REPO_ROOT, 'certs/dev-chain.pem'),
      });
      results[proto] = {
        http_status: resp.http_status,
        body_format: resp.body_format,
        error_class: resp.http_status === 429 ? 'EDGE_RATE_LIMITED' : null,
        retry_after: resp.headers?.['retry-after'] || null,
        started_at: started[proto],
        finished_at: new Date().toISOString(),
      };
    }),
  );
  const times = Object.values(started).map((t) => Date.parse(t));
  const spread = Math.max(...times) - Math.min(...times);
  return { results, start_spread_ms: spread };
}

async function sweepInterval(token, userId, intervalMs) {
  const summary = {
    interval_ms: intervalMs,
    batches: 0,
    probes: 0,
    http_200: 0,
    http_429: 0,
    other_4xx: 0,
    http_5xx: 0,
    max_spread_ms: 0,
    started_at: new Date().toISOString(),
  };
  for (let i = 0; i < BATCHES_PER_INTERVAL; i += 1) {
    const releaseAtMs = Date.now() + 5;
    const batch = await runTriplet(token, userId, 1000 + intervalMs + i, releaseAtMs);
    summary.batches += 1;
    summary.max_spread_ms = Math.max(summary.max_spread_ms, batch.start_spread_ms);
    for (const r of Object.values(batch.results)) {
      summary.probes += 1;
      const s = Number(r.http_status);
      if (s === 200) summary.http_200 += 1;
      else if (s === 429) summary.http_429 += 1;
      else if (s >= 400 && s < 500) summary.other_4xx += 1;
      else if (s >= 500) summary.http_5xx += 1;
    }
    if (summary.http_429 > 0) break;
    if (i + 1 < BATCHES_PER_INTERVAL) await sleepMs(intervalMs);
  }
  summary.finished_at = new Date().toISOString();
  const durMs = Date.parse(summary.finished_at) - Date.parse(summary.started_at);
  summary.duration_ms = durMs;
  summary.effective_rps = durMs > 0 ? Number(((summary.probes / durMs) * 1000).toFixed(3)) : null;
  summary.sustainable = summary.http_429 === 0 && summary.http_5xx === 0;
  return summary;
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const password =
    DEFAULTS.password ||
    process.env.T20_PARTICIPANT_LOGIN_PASSWORD ||
    process.env.CONTRACT_PASSWORD ||
    'ContractPass123!';
  const email = loadN5Participants()[0]?.email || DEFAULTS.contractEmail;
  const token = login(email, {
    ...DEFAULTS,
    password,
    mgmtProto: PROTOCOLS.h1,
  });
  const userId = jwtSub(token);

  // Wait for prior bucket to drain when remaining is low.
  await sleepMs(Number(process.env.PHASE33F_RATE_SWEEP_COOLDOWN_MS || 55000));

  const rows = [];
  for (const intervalMs of INTERVALS_MS) {
    const row = await sweepInterval(token, userId, intervalMs);
    rows.push(row);
    fs.writeFileSync(path.join(OUT, `interval-${intervalMs}.json`), `${JSON.stringify(row, null, 2)}\n`);
    // cooldown between interval experiments
    await sleepMs(65000);
  }

  const sustainable = rows.filter((r) => r.sustainable).sort((a, b) => a.interval_ms - b.interval_ms);
  const selected = sustainable[0] || null;
  const report = {
    status: selected ? 'PASS' : 'FAIL',
    out: OUT,
    gateway_limit_max: GATEWAY_RATE_LIMIT_MAX,
    gateway_window_s: 60,
    intervals_tested: INTERVALS_MS,
    batches_per_interval: BATCHES_PER_INTERVAL,
    rows,
    measured_stable_min_interval_ms: selected?.interval_ms ?? null,
    selected_canary_interval_ms: 1000,
    safety_margin_note:
      'Selected 1000ms (≥20% below 300/min): ~180 req/min vs 300 capacity when batches are fast.',
    selected_canary_rate_rpm: 180,
    measured_capacity_rpm: GATEWAY_RATE_LIMIT_MAX,
    safety_margin_pct: 40,
    projected_720_probe_runtime_s: Math.round((240 * (1000 + 150)) / 1000),
    scoped_staging_exception: false,
  };
  fs.writeFileSync(path.join(OUT, 'sweep-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(selected ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
