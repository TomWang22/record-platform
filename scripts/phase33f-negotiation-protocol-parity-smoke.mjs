#!/usr/bin/env node
/**
 * Phase 33F focused negotiation protocol-parity smoke (90 synchronized batches / 270 probes).
 * Root: /tmp/phase33f-negotiation-protocol-parity-smoke-v1
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireLauncherLock,
  generateRunId,
  initRunState,
  readRunId,
  sha256File,
} from './lib/phase32h-run-integrity.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { runCapabilityMatrix, closeCapabilityWorkerPool } from './lib/phase33f-capability-runner.mjs';
import { finalizePhase33fRun } from './lib/phase33f-run-finalize.mjs';
import { evaluateTerminalVerdictWithDelay } from './lib/phase33f-terminal-verdict.mjs';
import { hashManifest, writeManifest } from './lib/phase33f-canary-manifest.mjs';
import { PROTOCOLS } from './lib/phase33f-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = process.env.PHASE33F_PARITY_SMOKE_OUT || '/tmp/phase33f-negotiation-protocol-parity-smoke-v2';

const ALLOC = [
  { mode: 'unauthorized_thread', count: 30, side: 'buyer' },
  { mode: 'baseline', count: 15, side: 'buyer', authorized: true },
  { mode: 'baseline', count: 15, side: 'seller', authorized: true },
  { mode: 'deleted_thread', count: 10, side: 'buyer' },
  { mode: 'cross_user_thread_attempt', count: 10, side: 'buyer' },
  { mode: 'missing_thread', count: 10, side: 'buyer' },
];

function buildFocusedRows() {
  const rows = [];
  let batchIdx = 0;
  for (const alloc of ALLOC) {
    for (let i = 0; i < alloc.count; i += 1) {
      batchIdx += 1;
      const batch_id = `negparity_${String(batchIdx).padStart(4, '0')}_${alloc.mode}`;
      for (const protocol of PROTOCOLS) {
        const seed = 900000 + batchIdx * 10 + (protocol === 'h1' ? 1 : protocol === 'h2' ? 2 : 3);
        const request = {
          capability: 'negotiation_assistance',
          mode: alloc.mode,
          fixture_band: 'development',
          retrieval_mode: 'keyword_metadata',
        };
        const row = {
          scenario_id: `negotiation_${alloc.mode}_${i}`,
          probe_id: `${batch_id}_${protocol}`,
          batch_id,
          capability: 'negotiation_assistance',
          capability_mode: alloc.mode,
          schema_version: 'phase33f-negotiation_assistance-1',
          participant_side: alloc.side,
          principal_fixture: 'principal_a',
          authorization_scopes: ['authenticated_market', 'owner_private_fixture'],
          prohibited_scopes: ['cross_user_private', 'production_write'],
          conversation_or_session_id: alloc.authorized ? `thread_${batch_id}` : null,
          turns: 1,
          memory_classes: ['conversation_only'],
          request,
          expected_behavior: 'abstain_or_limit',
          expected_schema: 'intelligence-output-schemas/negotiation-assistance.schema.json',
          expected_evidence: true,
          expected_limitations: true,
          expected_abstention: { may_abstain: true },
          expected_safety: { automatic_send_allowed: false, production_mutation_allowed: false },
          expected_ranking_or_retrieval: false,
          expected_privacy: { cross_user_leakage: 0 },
          expected_freshness: 'labeled_ok',
          protocol,
          seed,
          run: 1,
          gate: protocol,
          production_mutation_allowed: false,
          fixture_sources: ['phase33d-scenarios'],
          tags: {
            multi_turn: false,
            privacy_adversarial: alloc.mode.includes('cross_user'),
            weak_or_stale: !alloc.authorized,
            exact_pressing: false,
          },
        };
        if (alloc.authorized) {
          row.request.authorized_thread_id = `thread_${batch_id}`;
          row.request.thread = {
            thread_id: `thread_${batch_id}`,
            participant_principals: ['principal_a', 'seller_b'],
          };
          row.request.requesting_principal_fixture = 'principal_a';
          row.request.subject = { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' };
          row.request.market_candidates = [];
        }
        if (alloc.mode === 'cross_user_thread_attempt') {
          row.request.unauthorized_thread = true;
          row.request.thread = {
            thread_id: `foreign_${batch_id}`,
            participant_principals: ['other_user'],
            owner_cross_user_attempt: true,
          };
          row.request.authorized_thread_id = `foreign_${batch_id}`;
          row.conversation_or_session_id = `foreign_${batch_id}`;
        }
        if (alloc.mode === 'deleted_thread') {
          row.request.thread = { thread_id: `deleted_${batch_id}`, participant_principals: ['principal_a'] };
          row.request.authorized_thread_id = `deleted_${batch_id}`;
          row.request.unauthorized_thread = true;
          row.conversation_or_session_id = `deleted_${batch_id}`;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

import { spawn } from 'node:child_process';

function startDetachedSync(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

async function main() {
  if (fs.existsSync(OUT)) {
    throw new Error(`refuse to reuse existing smoke root ${OUT}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const rows = buildFocusedRows();
  if (rows.length !== 270) throw new Error(`expected 270 probes, got ${rows.length}`);
  const manifestPath = path.join(OUT, 'phase33f-capability-manifest.json');
  writeManifest(manifestPath, rows, { batchesPerCapability: 90 });
  const manifestSha = hashManifest(rows);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  const runId = generateRunId();
  initRunState(OUT, {
    runId,
    launchHead: head,
    evidenceLabel: 'Phase 33F negotiation protocol-parity smoke',
    manifestPath,
  });
  acquireLauncherLock(OUT, { pid: process.pid, run_id: runId, role: 'parity-smoke' });

  const env = {
    ...process.env,
    PHASE33F_MATRIX_ROOT: OUT,
    CA_CERT: path.join(REPO_ROOT, 'certs/dev-chain.pem'),
  };
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), OUT], {
    cwd: REPO_ROOT,
  });
  registerPcapCollector(OUT, {
    run_id: runId,
    launch_head: head,
    manifest_sha: sha256File(manifestPath),
  });
  const telemetryPid = startDetachedSync(
    'bash',
    [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), OUT],
    env,
  );
  const supervisorPid = startDetachedSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', OUT],
    env,
  );

  let runnerResult;
  try {
    runnerResult = await runCapabilityMatrix({
      rows,
      outRoot: OUT,
      mode: 'smoke',
      runId,
      launchHead: head,
      manifestSha,
      caCert: env.CA_CERT,
    });
  } catch (err) {
    await closeCapabilityWorkerPool();
    finalizePhase33fRun({
      outRoot: OUT,
      repoRoot: REPO_ROOT,
      status: 'BLOCKED',
      failureClass: 'RUNNER_EXCEPTION',
      failureDetails: { message: err.message },
      mode: 'parity-smoke',
      launchHead: head,
      manifestSha,
      supervisorPid,
      telemetryPid,
    });
    throw err;
  }
  await closeCapabilityWorkerPool();

  const verdict = await evaluateTerminalVerdictWithDelay(OUT, {
    expectedProbes: 270,
    expectedBatches: 90,
    delayMs: Number(process.env.PHASE33F_VERDICT_DELAY_MS || 5000),
  });
  const pass = runnerResult.status === 'PASS' && verdict.status === 'PASS';
  const freeze = finalizePhase33fRun({
    outRoot: OUT,
    repoRoot: REPO_ROOT,
    status: pass ? 'PASS' : 'BLOCKED',
    failureClass: pass ? null : 'PARITY_SMOKE_FAIL',
    failureDetails: pass ? null : { runner: runnerResult, verdict },
    mode: 'parity-smoke',
    launchHead: head,
    manifestSha,
    runner: runnerResult,
    verdict,
    supervisorPid,
    telemetryPid,
  });

  const launch = {
    status: pass ? 'PASS' : 'FAIL',
    out: OUT,
    run_id: readRunId(OUT),
    probes: 270,
    batches: 90,
    unexpected_http_422: null,
    freeze,
    production_enablement: 'NOT APPROVED',
  };
  // count 422 from shards
  let unexpected422 = 0;
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(OUT, `shard-${shard}`, 'phase33f-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.http_status === 422 && !row.expected_4xx) unexpected422 += 1;
    }
  }
  launch.unexpected_http_422 = unexpected422;
  fs.writeFileSync(path.join(OUT, 'phase33f-launch.json'), `${JSON.stringify(launch, null, 2)}\n`);
  console.log(JSON.stringify(launch, null, 2));
  if (!pass || unexpected422 > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
