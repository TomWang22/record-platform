#!/usr/bin/env node
/**
 * Phase 33F target-readiness telemetry smoke.
 * 184 synchronized triplets (23 batches × 8 capabilities) at phase33f-rate-v1 pacing.
 * Root: /tmp/phase33f-target-telemetry-smoke-v1 — never the real target root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  DEFAULTS,
  login,
  jwtSub,
  loadN5Participants,
  PROTOCOLS,
} from './lib/phase22-full-replay-common.mjs';
import { buildCanaryManifest } from './lib/phase33f-canary-manifest.mjs';
import { runCapabilityMatrix } from './lib/phase33f-capability-runner.mjs';
import { finalizePhase33fRun } from './lib/phase33f-run-finalize.mjs';
import { INTER_BATCH_INTERVAL_MS, RATE_POLICY_VERSION, sleepMs } from './lib/phase33f-rate-limit.mjs';
import { generateRunId, initRunState, acquireLauncherLock } from './lib/phase32h-run-integrity.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { REAL_TARGET_ROOT } from './lib/phase33f-canary-config.mjs';
import { hashCanonicalWorkload, computeManifestShaFromRows } from './lib/phase33f-workload-hash.mjs';
import {
  readRunnerResourceTelemetryTail,
  evaluateResourcePolicy,
  projectResourceToBatch,
} from './lib/phase33f-runner-resource-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = process.env.PHASE33F_TELEMETRY_SMOKE_OUT || '/tmp/phase33f-target-telemetry-smoke-v1';
const BATCHES_PER_CAP = Number(process.env.PHASE33F_TELEMETRY_SMOKE_BPC || 23);

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

async function main() {
  if (fs.existsSync(REAL_TARGET_ROOT)) {
    throw new Error('refusing telemetry smoke while real target root exists');
  }
  if (fs.existsSync(OUT)) {
    throw new Error(`telemetry smoke root must be absent: ${OUT}`);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const rows = buildCanaryManifest({ batchesPerCapability: BATCHES_PER_CAP });
  const manifestSha = computeManifestShaFromRows(rows);
  const workload = hashCanonicalWorkload(rows);
  const runId = generateRunId();
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();

  initRunState(OUT, {
    runId,
    launchHead: head,
    evidenceLabel: 'Phase 33F target telemetry smoke',
    manifestPath: path.join(OUT, 'phase33f-capability-manifest.json'),
  });
  fs.writeFileSync(
    path.join(OUT, 'phase33f-capability-manifest.json'),
    `${JSON.stringify({ probes: rows, manifest_sha: manifestSha }, null, 2)}\n`,
  );
  acquireLauncherLock(OUT, { pid: process.pid, run_id: runId, role: 'telemetry-smoke' });

  await sleepMs(Number(process.env.PHASE33F_TELEMETRY_SMOKE_COOLDOWN_MS || 1000));

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), OUT], {
    cwd: REPO_ROOT,
  });
  registerPcapCollector(OUT, {
    run_id: runId,
    launch_head: head,
    manifest_sha: manifestSha,
  });
  const env = {
    ...process.env,
    CA_CERT: process.env.CA_CERT || path.join(REPO_ROOT, 'certs/dev-chain.pem'),
  };
  const telemetryPid = startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), OUT], env);
  const supervisorPid = startDetached(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', OUT],
    env,
  );

  const password =
    DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!';
  const participants = loadN5Participants();
  const token = login(participants[0]?.email || DEFAULTS.contractEmail, {
    ...DEFAULTS,
    password,
    caCert: env.CA_CERT,
    mgmtProto: PROTOCOLS.h1,
  });
  const userId = jwtSub(token);

  const runner = await runCapabilityMatrix({
    rows,
    outRoot: OUT,
    mode: 'canary',
    runId,
    launchHead: head,
    manifestSha,
    interBatchIntervalMs: INTER_BATCH_INTERVAL_MS,
    token,
    userId,
    caCert: env.CA_CERT,
  });

  const tel = await readRunnerResourceTelemetryTail(OUT, { limit: 10_000 });
  const policy = evaluateResourcePolicy(tel.rows, {
    workerFinal: runner.resource_final?.workers ?? null,
    messagePortFinal: runner.resource_final?.message_ports ?? null,
    listenerFinal: runner.resource_final?.listeners ?? null,
    activeHandleFinal: runner.resource_final?.active_handles ?? null,
    baseline: runner.resource_baseline,
  });
  const projection = projectResourceToBatch(tel.rows, 5760);

  const pass =
    runner.status === 'PASS' &&
    policy.status === 'PASS' &&
    runner.ok_count === rows.length &&
    !runner.stopped_for_rate_limit;

  const freeze = finalizePhase33fRun({
    outRoot: OUT,
    repoRoot: REPO_ROOT,
    status: pass ? 'PASS' : 'BLOCKED',
    failureClass: pass ? null : runner.failure_class || policy.code || 'TELEMETRY_SMOKE_FAIL',
    failureDetails: pass ? null : { runner, policy },
    mode: 'telemetry-smoke',
    launchHead: head,
    manifestSha,
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
    ok_count: runner.ok_count,
    fail_count: runner.fail_count,
    http_429: runner.stopped_for_rate_limit ? 1 : 0,
    resource_policy: policy,
    resource_baseline: runner.resource_baseline,
    resource_peaks: runner.resource_peaks,
    resource_final: runner.resource_final,
    projection_batch_5760: projection,
    manifest_sha: manifestSha,
    canonical_workload_hash: workload.canonical_workload_hash,
    freeze,
  };
  const proofPath = path.join(OUT, 'telemetry-smoke-proof.json');
  const body = `${JSON.stringify(proof, null, 2)}\n`;
  proof.proof_sha256 = createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  fs.copyFileSync(proofPath, '/tmp/phase33f-target-readiness-hardening/telemetry-smoke-proof.json');
  console.log(JSON.stringify(proof, null, 2));
  if (!pass) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
