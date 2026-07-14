#!/usr/bin/env node
/**
 * Phase 32H-R1 — synchronized triplet orchestrator for main 8,640-probe matrix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  PROTOCOLS,
  login,
  resolveCurlTarget,
  sha256File,
  gitSha,
  loadN5Participants,
} from './lib/phase22-full-replay-common.mjs';
import { loadJsonl, classifyMatrixProbeFailure } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  coordinatorRootFromRunnerOut,
  PreviewWindowCoordinator,
  resetAndVerifyWindowGates,
} from './lib/phase31-preview-window-coordinator.mjs';
import {
  acquireLauncherLock,
  assertAppendAllowed,
  assertLaunchableEvidenceRoot,
  isCoverageBlocked,
  readLaunchHead,
  readRunId,
  recordCompletedProbe,
  runStatePaths,
} from './lib/phase32h-run-integrity.mjs';
import { groupManifestIntoTriplets } from './lib/phase32h-triplet-manifest.mjs';
import {
  executeTripletBatch,
  writeTripletOrchestratorMarker,
  closeTripletWorkerPool,
  getTripletWorkerPool,
} from './lib/phase32h-triplet-orchestrator.mjs';
import { serviceCorrelationQueueBeforeBatch, readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import {
  appendMemoryTelemetry,
  sampleMemoryTelemetry,
  shouldSampleMemoryTelemetry,
} from './lib/phase32h-memory-telemetry.mjs';
import {
  evidenceLabelForArm,
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from './lib/phase32h-r1-config.mjs';
import { supervisorTick } from './phase32h-collector-supervisor.mjs';
import { assertManifestContract } from './lib/phase32h-manifest-contract.mjs';
import { assertPacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { teardownBlockedRun } from './lib/phase32h-blocked-run-teardown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-baseline', arm: 'baseline', limit: null, canary: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--arm') opts.arm = argv[++i];
    if (argv[i] === '--limit') opts.limit = Number(argv[++i]);
    if (argv[i] === '--canary') opts.canary = true;
  }
  return opts;
}

function appendRow(outRoot, proto, row) {
  const shard = path.join(outRoot, `shard-${proto}`, 'phase32h-matrix.jsonl');
  fs.mkdirSync(path.dirname(shard), { recursive: true });
  fs.appendFileSync(shard, `${JSON.stringify(row)}\n`, 'utf8');
}

export async function runTripletMatrix(opts) {
  assertLaunchableEvidenceRoot(opts.out);
  if (!opts.out.startsWith('/tmp/')) throw new Error('triplet runner out must be under /tmp');
  const outRoot = opts.out;
  const manifestPath = path.join(outRoot, 'phase32h-r1-manifest.jsonl');
  // Manifest is fixed-size for a run; load once then group (matrix JSONL shards use append-only growth).
  const manifest = loadJsonl(manifestPath);
  const evidenceLabel = opts.evidenceLabel || evidenceLabelForArm(opts.arm, { canary: opts.canary });
  const expectedTotal = opts.expectedTotal ?? (opts.canary ? R1_CANARY_TOTAL : R1_TOTAL);
  const expectedPerProtocol = opts.expectedPerProtocol ?? (opts.canary ? R1_CANARY_PER_PROTOCOL : R1_PER_PROTOCOL);
  assertManifestContract(manifest, {
    evidenceLabel,
    expectedTotal,
    expectedPerProtocol,
  });
  let batches = groupManifestIntoTriplets(manifest);
  if (opts.limit != null) batches = batches.slice(0, opts.limit);

  const completedBatchIds = new Set(
    fs.existsSync(path.join(outRoot, 'batches'))
      ? fs
          .readdirSync(path.join(outRoot, 'batches'))
          .filter((name) => name.endsWith('.json'))
          .map((name) => name.replace(/\.json$/, ''))
      : [],
  );
  if (completedBatchIds.size > 0) {
    batches = batches.filter((batch) => !completedBatchIds.has(batch.batch_id));
  }

  const runId = readRunId(outRoot);
  const launchHead = readLaunchHead(outRoot) || gitSha();
  const manifestSha = sha256File(manifestPath);

  serviceCorrelationQueueBeforeBatch(outRoot, { runId, launchHead, manifestSha });

  writeTripletOrchestratorMarker(outRoot, {
    status: 'IN_PROGRESS',
    orchestrator: 'phase32h-r1-triplet-runner',
    run_id: runId,
    launch_head: launchHead,
    manifest_sha: manifestSha,
    batch_count: batches.length,
    started_at: new Date().toISOString(),
  });

  const cfg = {
    ...DEFAULTS,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    ragPauseMs: Number(process.env.T20_EVAL_RAG_PAUSE_SEC || '0.15') * 1000,
    mgmtProto: PROTOCOLS.h1,
  };

  const users = loadN5Participants();
  const tokenCache = new Map();
  const getToken = (email) => {
    if (!tokenCache.has(email)) tokenCache.set(email, login(email, cfg));
    return tokenCache.get(email);
  };

  const coordinator = new PreviewWindowCoordinator(coordinatorRootFromRunnerOut(outRoot), {
    matrixId: 'phase32h-r1',
    windowSequence: [...new Set(batches.map((b) => b.coordinate.window))].sort((a, b) => a - b),
    expectedProtocols: ['triplet'],
  });

  let completedBatches = completedBatchIds.size;
  let lastMemorySampleAtMs = 0;
  const emitMemorySample = (force = false) => {
    if (
      !shouldSampleMemoryTelemetry(completedBatches, {
        lastSampleAtMs: lastMemorySampleAtMs,
        force,
      })
    ) {
      return;
    }
    const pool = getTripletWorkerPool();
    const queueSnap = readCorrelationQueueSnapshot(outRoot);
    appendMemoryTelemetry(
      outRoot,
      sampleMemoryTelemetry({
        completed_batch: completedBatches,
        batch_complete: completedBatches,
        probe_total: completedBatches * 3,
        worker_count: pool?.workerCount ?? 0,
        worker_queue_depth: pool?.queueDepth ?? 0,
        correlation_pending: queueSnap.pending_count ?? 0,
        correlation_running: queueSnap.running_count ?? 0,
        correlation_complete_total: queueSnap.complete_count ?? 0,
      }),
    );
    lastMemorySampleAtMs = Date.now();
    if (completedBatches % 10 === 0 || force) {
      process.stderr.write(`phase32h-r1 triplet progress: ${completedBatches}/${batches.length}\n`);
    }
  };

  for (const batch of batches) {
    if (isCoverageBlocked(outRoot)) {
      throw new Error('collector coverage blocked; stopping triplet matrix');
    }
    supervisorTick(outRoot, { probesActive: true, smokeMode: false });

    const results = await executeTripletBatch({
      outRoot,
      batch,
      cfg,
      runId,
      launchHead,
      manifestSha,
      evidenceLabel,
      coordinator,
      probeContext: {
        resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, cfg),
        manifestSha,
        launchHead,
        runId,
        evidenceLabel,
      },
      onProbeComplete: (probe, row, root) => {
        row.run_id = runId;
        row.git_sha = launchHead;
        row.evidence_label = evidenceLabel;
        row.batch_id = batch.batch_id;
        assertAppendAllowed(root, probe, row, {
          manifestPath,
          evidenceLabel,
          launchHead,
          protocolKey: probe.matrix_protocol,
        });
        appendRow(root, probe.matrix_protocol, row);
        recordCompletedProbe(root, probe, row);
      },
    });

    completedBatches += 1;
    emitMemorySample(false);

    // Optional boundary pause so status polls can observe ALIGNED between batches.
    const boundaryPauseMs = Number(process.env.PHASE32H_LIFECYCLE_BOUNDARY_PAUSE_MS || 0);
    if (Number.isFinite(boundaryPauseMs) && boundaryPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, boundaryPauseMs));
    }

    if (results.batchRecord.batch_timing_status === 'REJECTED') break;
  }
  emitMemorySample(true);

  writeTripletOrchestratorMarker(outRoot, {
    status: 'COMPLETE',
    orchestrator: 'phase32h-r1-triplet-runner',
    run_id: runId,
    completed_batches: completedBatches,
    phase: 'COMPLETE',
    active_batch_id: null,
    finished_at: new Date().toISOString(),
  });

  if (completedBatches === batches.length && batches.length > 0) {
    assertPacketIndexCoverage(outRoot, {
      expectedProbeIndexes: batches.length * 3,
      expectedBatchCorrelations: batches.length,
      requirePerProbeIndexes: true,
    });
  }

  await closeTripletWorkerPool();

  return { completedBatches, totalBatches: batches.length };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  acquireLauncherLock(opts.out, { pid: process.pid, run_id: readRunId(opts.out), role: 'triplet-runner' });
  const result = await runTripletMatrix(opts);
  console.log(JSON.stringify({ status: 'PASS', ...result }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cliOpts = parseArgs(process.argv.slice(2));
  main().catch((err) => {
    if (cliOpts.out && (err?.code === 'COVERAGE_BLOCKED' || isCoverageBlocked(cliOpts.out))) {
      try {
        const teardown = teardownBlockedRun(cliOpts.out, {
          repoRoot: REPO_ROOT,
          reason: err?.message || 'COLLECTOR_COVERAGE_BLOCKED',
          classification: 'BLOCKED',
          hashManifestName: 'phase32h-r1-blocked-sha256.txt',
        });
        console.error(JSON.stringify({ teardown, original_error: err.message }, null, 2));
      } catch (teardownErr) {
        console.error(teardownErr);
      }
    } else {
      console.error(err);
    }
    process.exit(2);
  });
}
