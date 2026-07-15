#!/usr/bin/env node
/**
 * Aggregate Phase 33F offline package verifier for CI.
 * Expects current readiness to be BLOCKED until semantic quality is remediated.
 * Ensures canary root is not created by offline verification.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANARY = '/tmp/phase33f-capability-gauntlet-canary-v1';

function run(script, accept = [0]) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (!accept.includes(r.status ?? 1)) {
    throw new Error(`${script}_exit_${r.status}`);
  }
  return r;
}

const before = fs.existsSync(CANARY);
run('verify-phase33f-manifest.mjs', [0]);
run('verify-phase33f-protocol-parity.mjs', [0]);
run('verify-phase33f-collectors.mjs', [0]);
const readiness = run('verify-phase33f-readiness.mjs', [0, 3]);
run('verify-phase33f-canary.mjs', [0, 3]);
const after = fs.existsSync(CANARY);

let readinessJson = {};
try {
  readinessJson = JSON.parse(readiness.stdout || '{}');
} catch {
  readinessJson = {};
}

const violations = [];
if (after && !before) violations.push('canary_root_created_during_offline_verify');
if (readinessJson.status === 'READY') {
  // Ready is fine for CI; canary still not launched.
} else if (readinessJson.status !== 'BLOCKED') {
  violations.push(`unexpected_readiness_status:${readinessJson.status}`);
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  readiness_status: readinessJson.status,
  banner: readinessJson.banner,
  canary_root_created: after && !before,
  canary_launched: false,
  target_launched: false,
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
