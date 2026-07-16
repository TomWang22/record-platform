#!/usr/bin/env node
/**
 * Phase 33F rate-capacity preflight smoke: 60 synchronized triplets @ approved pacing.
 * Root: /tmp/phase33f-rate-capacity-smoke-v1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  DEFAULTS,
  login,
  jwtSub,
  loadN5Participants,
  PROTOCOLS,
} from './lib/phase22-full-replay-common.mjs';
import { runCapabilityMatrix } from './lib/phase33f-capability-runner.mjs';
import { finalizePhase33fRun } from './lib/phase33f-run-finalize.mjs';
import {
  INTER_BATCH_INTERVAL_MS,
  RATE_POLICY_VERSION,
  sleepMs,
} from './lib/phase33f-rate-limit.mjs';
import { generateRunId, initRunState, acquireLauncherLock } from './lib/phase32h-run-integrity.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = process.env.PHASE33F_RATE_CAPACITY_OUT || '/tmp/phase33f-rate-capacity-smoke-v1';
const BATCHES = Number(process.env.PHASE33F_RATE_CAPACITY_BATCHES || 60);

function buildRows() {
  const rows = [];
  for (let b = 1; b <= BATCHES; b += 1) {
    const batch_id = `ratecap_${String(b).padStart(4, '0')}_scarcity`;
    for (const protocol of ['h1', 'h2', 'h3']) {
      rows.push({
        probe_id: `${batch_id}_${protocol}`,
        batch_id,
        capability: 'scarcity',
        protocol,
        capability_mode: 'baseline',
        schema_version: 'phase33f-rate-capacity-1',
        principal_fixture: 'principal_a',
        authorization_scopes: ['authenticated_market'],
        prohibited_scopes: ['production_write'],
        conversation_or_session_id: null,
        turns: 1,
        memory_classes: [],
        seed: 40000 + b * 3 + (protocol === 'h1' ? 0 : protocol === 'h2' ? 1 : 2),
        expected_behavior: 'answer',
        tags: {},
        request: {
          capability: 'scarcity',
          mode: 'baseline',
          fixture_band: 'development',
          production_mutation_allowed: false,
        },
      });
    }
  }
  return rows;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

async function main() {
  if (fs.existsSync(OUT)) {
    const frozen =
      fs.existsSync(path.join(OUT, 'FROZEN_PASS_EVIDENCE')) ||
      fs.existsSync(path.join(OUT, 'FROZEN_BLOCKED_EVIDENCE'));
    if (frozen) {
      console.error(JSON.stringify({ status: 'BLOCKED', reason: 'frozen_root_present', out: OUT }));
      process.exit(3);
    }
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  // Cool down gateway bucket after prior sweeps / canaries.
  await sleepMs(Number(process.env.PHASE33F_RATE_CAPACITY_COOLDOWN_MS || 65000));

  const password =
    DEFAULTS.password ||
    process.env.T20_PARTICIPANT_LOGIN_PASSWORD ||
    process.env.CONTRACT_PASSWORD ||
    'ContractPass123!';
  const email = loadN5Participants()[0]?.email || DEFAULTS.contractEmail;
  const token = login(email, { ...DEFAULTS, password, mgmtProto: PROTOCOLS.h1 });
  const userId = jwtSub(token);
  const rows = buildRows();
  const runId = generateRunId();
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  initRunState(OUT, {
    runId,
    launchHead: head,
    evidenceLabel: 'Phase 33F rate-capacity smoke',
  });
  acquireLauncherLock(OUT, { pid: process.pid, run_id: runId, role: 'rate-capacity-smoke' });

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), OUT], {
    cwd: REPO_ROOT,
  });
  registerPcapCollector(OUT, { run_id: runId, launch_head: head, manifest_sha: RATE_POLICY_VERSION });
  const telemetryPid = startDetached('bash', [
    path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'),
    OUT,
  ]);
  const supervisorPid = startDetached(process.execPath, [
    path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'),
    '--out',
    OUT,
  ]);

  const runner = await runCapabilityMatrix({
    rows,
    outRoot: OUT,
    mode: 'canary',
    runId,
    launchHead: head,
    token,
    userId,
    skipLogin: true,
    interBatchIntervalMs: INTER_BATCH_INTERVAL_MS,
  });

  const http429 = (runner.batch_results || [])
    .flatMap((b) => Object.values(b.results || {}))
    .filter((r) => Number(r.http_status) === 429).length;
  const spreads = (runner.batch_results || []).map((b) => Number(b.start_spread_ms) || 0);
  const maxSpread = spreads.length ? Math.max(...spreads) : 0;
  const pass =
    runner.status === 'PASS' &&
    runner.ok_count === BATCHES * 3 &&
    http429 === 0 &&
    maxSpread <= 100;

  const freeze = finalizePhase33fRun({
    outRoot: OUT,
    repoRoot: REPO_ROOT,
    status: pass ? 'PASS' : 'BLOCKED',
    failureClass: pass ? null : runner.failure_class || 'RATE_CAPACITY_SMOKE_FAIL',
    failureDetails: pass ? null : { runner, http429, maxSpread },
    mode: 'rate-capacity-smoke',
    launchHead: head,
    manifestSha: RATE_POLICY_VERSION,
    runner,
    supervisorPid,
    telemetryPid,
  }).freeze;

  const proof = {
    status: pass ? 'PASS' : 'FAIL',
    out: OUT,
    rate_policy_version: RATE_POLICY_VERSION,
    inter_batch_interval_ms: INTER_BATCH_INTERVAL_MS,
    batches: runner.batches,
    probes: runner.probes,
    http_200: runner.ok_count,
    http_429: http429,
    max_triplet_spread_ms: maxSpread,
    freeze,
    proof_sha256: null,
  };
  const proofPath = path.join(OUT, 'rate-capacity-smoke-proof.json');
  const body = `${JSON.stringify(proof, null, 2)}\n`;
  proof.proof_sha256 = createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  // copy proof outside for preflight pin
  fs.mkdirSync('/tmp/phase33f-canary-v2-rate-limit-rca', { recursive: true });
  fs.copyFileSync(proofPath, '/tmp/phase33f-canary-v2-rate-limit-rca/rate-capacity-smoke-proof.json');
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
