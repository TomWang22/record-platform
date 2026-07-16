#!/usr/bin/env node
/**
 * Static + optional proof checks for Phase 33F rate-capacity packaging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  INTER_BATCH_INTERVAL_MS,
  INTER_BATCH_INTERVAL_MIN_MS,
  RATE_POLICY_VERSION,
  GATEWAY_RATE_LIMIT_MAX,
} from '../lib/phase33f-rate-limit.mjs';
import { CANARY } from '../lib/phase33f-canary-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const REQUIRED = [
  'scripts/lib/phase33f-rate-limit.mjs',
  'scripts/phase33f-rate-capacity-smoke.mjs',
  'scripts/phase33f-rate-limit-sweep.mjs',
  'tests/phase33f-rate-limit-observability.test.mjs',
];

const violations = [];
for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(REPO_ROOT, rel))) violations.push(`missing:${rel}`);
}

try {
  await import(pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/phase33f-rate-limit.mjs')).href);
} catch (err) {
  violations.push(`import_fail:phase33f-rate-limit:${err.message}`);
}

if (CANARY.inter_batch_interval_ms !== INTER_BATCH_INTERVAL_MS) {
  violations.push('canary_interval_mismatch');
}
if (CANARY.inter_batch_interval_ms < INTER_BATCH_INTERVAL_MIN_MS) {
  violations.push('canary_interval_below_min');
}
if (CANARY.rate_policy_version !== RATE_POLICY_VERSION) {
  violations.push('rate_policy_version_mismatch');
}
if (GATEWAY_RATE_LIMIT_MAX !== 300) {
  violations.push('gateway_limit_constant_drift');
}

const probeText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/phase33f-capability-probe.mjs'), 'utf8');
if (!probeText.includes('EDGE_RATE_LIMITED')) violations.push('probe_missing_rate_class');
const curlText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/phase22-full-replay-common.mjs'), 'utf8');
if (!curlText.includes('dump-header') || !curlText.includes('json_parse_status')) {
  violations.push('curl_missing_status_body_separation');
}
const runnerText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/phase33f-capability-runner.mjs'), 'utf8');
if (!runnerText.includes('interBatchIntervalMs') || !runnerText.includes('stopped_for_rate_limit')) {
  violations.push('runner_missing_pacing_or_fail_closed');
}

// Never allow a global unlimited bypass in gateway source.
const gw = fs.readFileSync(path.join(REPO_ROOT, 'services/api-gateway/src/app.ts'), 'utf8');
if (/max:\s*Infinity|max:\s*Number\.MAX/.test(gw)) violations.push('gateway_unlimited_bypass');
if (!gw.includes('X-Loadtest') || !gw.includes('x-rp-e2e-contract')) {
  // existing scoped skips are ok; ensure no blanket skip-all
}
if (/skip:\s*\(\)\s*=>\s*true/.test(gw)) violations.push('gateway_skip_all');

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  rate_policy_version: RATE_POLICY_VERSION,
  inter_batch_interval_ms: INTER_BATCH_INTERVAL_MS,
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
