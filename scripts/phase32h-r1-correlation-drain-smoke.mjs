#!/usr/bin/env node
/**
 * Phase 32H-R1 — correlation queue drain smoke (>50 batches).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import { groupManifestIntoTriplets } from './lib/phase32h-triplet-manifest.mjs';
import { R1_EVIDENCE_LABEL_BASELINE } from './lib/phase32h-r1-config.mjs';
import {
  acquireLauncherLock,
  generateRunId,
  initRunState,
  sha256File,
} from './lib/phase32h-run-integrity.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { runTripletMatrix } from './phase32h-r1-triplet-runner.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { executeFreezeIntegrity, stopWritersForRoot } from './lib/phase32h-freeze-integrity.mjs';
import { withSmokeCollectorCleanup } from './lib/phase32h-smoke-collector-cleanup.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/phase32h-r1-correlation-drain-smoke-v1';
const TARGET_BATCHES = 60;
const TARGET_PROBES = TARGET_BATCHES * 3;

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]))
    );
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('drain smoke out must be under /tmp');

  return withSmokeCollectorCleanup(
    opts.out,
    async () => {
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });

  const full = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
  const batches = groupManifestIntoTriplets(full).slice(0, TARGET_BATCHES);
  const rows = batches.flatMap((b) => [b.h1, b.h2, b.h3]);
  const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

  const runId = generateRunId();
  const launchHead = gitSha();
  const evidenceLabel = R1_EVIDENCE_LABEL_BASELINE;
  initRunState(opts.out, { runId, launchHead, evidenceLabel, manifestPath });
  acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'drain-smoke' });

  const env = { ...process.env, PHASE32H_MATRIX_ROOT: opts.out, T20_EVAL_RAG_PAUSE_SEC: '0.15' };
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
  registerPcapCollector(opts.out, { run_id: runId, launch_head: launchHead, manifest_sha: sha256File(manifestPath) });
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out], env);
  startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out], env);
  startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], env);
  startDetached(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', opts.out],
    env,
  );

  const matrixResult = await runTripletMatrix({
    out: opts.out,
    arm: 'baseline',
    evidenceLabel,
    expectedTotal: TARGET_PROBES,
    expectedPerProtocol: TARGET_BATCHES,
    limit: TARGET_BATCHES,
  });

  const queue = readCorrelationQueueSnapshot(opts.out);
  const packetIndex = evaluatePacketIndexCoverage(opts.out, {
    expectedProbeIndexes: TARGET_PROBES,
    expectedBatchCorrelations: TARGET_BATCHES,
    requirePerProbeIndexes: true,
  });

  const pass =
    matrixResult.completedBatches === TARGET_BATCHES &&
    queue.pending_count === 0 &&
    queue.running_count === 0 &&
    queue.complete_count === TARGET_BATCHES &&
    queue.failed_count === 0 &&
    packetIndex.probe_index_count === TARGET_PROBES &&
    packetIndex.batch_correlation_count === TARGET_BATCHES;

  const report = {
    status: pass ? 'PASS' : 'BLOCKED',
    out: opts.out,
    run_id: runId,
    launch_head: launchHead,
    manifest_sha256: sha256File(manifestPath),
    matrix_result: matrixResult,
    queue,
    packet_index: packetIndex,
    target_batches: TARGET_BATCHES,
    target_probes: TARGET_PROBES,
  };
  fs.writeFileSync(path.join(opts.out, 'phase32h-r1-correlation-drain-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (pass) {
    executeFreezeIntegrity({
      outRoot: opts.out,
      repoRoot: REPO_ROOT,
      hashManifestName: 'phase32h-r1-correlation-drain-smoke-sha256.txt',
      hashExcludeSuffixes: ['phase32h-r1-correlation-drain-smoke-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
      markerName: 'FROZEN_PASS_EVIDENCE',
      markerContent: `${new Date().toISOString()}\nCORRELATION_DRAIN_SMOKE_PASS\n`,
      jsonlPaths: ['h1', 'h2', 'h3'].map((s) => path.join(opts.out, `shard-${s}`, 'phase32h-matrix.jsonl')),
      writersAlreadyStopped: true,
    });
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 2);
    },
    { repoRoot: REPO_ROOT },
  );
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
