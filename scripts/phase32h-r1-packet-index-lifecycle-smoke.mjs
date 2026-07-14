#!/usr/bin/env node
/**
 * Phase 32H-R1 — packet-index lifecycle smoke (90 probes / 30 batches).
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
import { BATCH_INDEX_ALIGNMENT, BATCH_INDEX_LIFECYCLE } from './lib/phase32h-packet-index-lifecycle.mjs';
import { runTripletMatrix } from './phase32h-r1-triplet-runner.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { listRootScopedProcesses, verifyOpenFiles, executeFreezeIntegrity } from './lib/phase32h-freeze-integrity.mjs';
import { stopRootScopedCollectors } from './lib/phase32h-blocked-run-teardown.mjs';
import { finalizeSmokeWithFreeze, withSmokeCollectorCleanup } from './lib/phase32h-smoke-collector-cleanup.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { listBatchPacketIndexes } from './lib/phase32h-batch-packet-index.mjs';
import { buildPhase32hSummary, loadShardRows } from './lib/phase32h-targeted-summary.mjs';
import { buildRuntimeStatus } from './phase32h-runtime-status-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/phase32h-r1-packet-index-lifecycle-smoke-v1';
const TARGET_BATCHES = 30;
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
  if (!opts.out.startsWith('/tmp/')) throw new Error('lifecycle smoke out must be under /tmp');
  if (opts.out.includes('phase32h-r1-baseline-r9')) {
    throw new Error('refusing to use frozen baseline-r9 root');
  }

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
      acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'packet-index-lifecycle-smoke' });

      fs.writeFileSync(
        path.join(opts.out, 'phase32h-r1-launch.json'),
        `${JSON.stringify(
          {
            status: 'IN_PROGRESS',
            arm: 'baseline',
            evidence_label: evidenceLabel,
            out: opts.out,
            run_id: runId,
            launch_head: launchHead,
            target_total: TARGET_PROBES,
            target_per_protocol: TARGET_BATCHES,
            triplet_batches: TARGET_BATCHES,
          },
          null,
          2,
        )}\n`,
      );

      const env = {
        ...process.env,
        PHASE32H_MATRIX_ROOT: opts.out,
        T20_EVAL_RAG_PAUSE_SEC: '0.15',
        PHASE32H_LIFECYCLE_BOUNDARY_PAUSE_MS: '80',
      };
      Object.assign(process.env, {
        PHASE32H_MATRIX_ROOT: opts.out,
        T20_EVAL_RAG_PAUSE_SEC: '0.15',
        PHASE32H_LIFECYCLE_BOUNDARY_PAUSE_MS: '80',
      });
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
        cwd: REPO_ROOT,
      });
      registerPcapCollector(opts.out, {
        run_id: runId,
        launch_head: launchHead,
        manifest_sha: sha256File(manifestPath),
      });
      startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
      startDetached(
        'bash',
        [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out],
        env,
      );
      startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out], env);
      startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], env);
      startDetached(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', opts.out],
        env,
      );

      const observed = { ACTIVE_TRANSIENT_LEAD: 0, ALIGNED: 0 };
      const poller = setInterval(() => {
        try {
          const st = buildRuntimeStatus(opts.out);
          const pi = st.packet_index || {};
          const status = pi.status;
          const life = pi.lifecycle_status || pi.classification;
          if (
            status === BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD ||
            life === BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD
          ) {
            observed.ACTIVE_TRANSIENT_LEAD += 1;
          }
          if (status === BATCH_INDEX_ALIGNMENT.ALIGNED || life === BATCH_INDEX_ALIGNMENT.ALIGNED) {
            observed.ALIGNED += 1;
          }
        } catch {
          // ignore transient read races
        }
      }, 200);

      let matrixResult;
      try {
        matrixResult = await runTripletMatrix({
          out: opts.out,
          arm: 'baseline',
          evidenceLabel,
          expectedTotal: TARGET_PROBES,
          expectedPerProtocol: TARGET_BATCHES,
          limit: TARGET_BATCHES,
        });
      } finally {
        clearInterval(poller);
      }

      const queue = readCorrelationQueueSnapshot(opts.out);
      const packetIndex = evaluatePacketIndexCoverage(opts.out, {
        expectedProbeIndexes: TARGET_PROBES,
        expectedBatchCorrelations: TARGET_BATCHES,
        requirePerProbeIndexes: true,
        completedBatchCount: TARGET_BATCHES,
        targetBatches: TARGET_BATCHES,
        targetProbes: TARGET_PROBES,
        matrixTotal: TARGET_PROBES,
      });
      const batchIndexes = listBatchPacketIndexes(opts.out);
      const pendingIndexes = batchIndexes.filter(
        (b) => b.record?.packet_correlation_status === BATCH_INDEX_LIFECYCLE.PENDING,
      ).length;
      const completeIndexes = batchIndexes.filter(
        (b) => b.record?.packet_correlation_status === BATCH_INDEX_LIFECYCLE.COMPLETE,
      ).length;

      const matrixRows = loadShardRows(opts.out);
      const http200 = matrixRows.filter((r) => Number(r.http_status) === 200).length;
      const http422 = matrixRows.filter((r) => Number(r.http_status) === 422).length;
      const summary = buildPhase32hSummary(opts.out, matrixRows);

      const capture = fs.existsSync(path.join(opts.out, 'pcap/capture-status.json'))
        ? JSON.parse(fs.readFileSync(path.join(opts.out, 'pcap/capture-status.json'), 'utf8'))
        : null;

      const pass =
        matrixResult.completedBatches === TARGET_BATCHES &&
        http200 === TARGET_PROBES &&
        http422 === 0 &&
        queue.pending_count === 0 &&
        queue.running_count === 0 &&
        queue.complete_count === TARGET_BATCHES &&
        queue.failed_count === 0 &&
        packetIndex.probe_index_count === TARGET_PROBES &&
        packetIndex.batch_correlation_count === TARGET_BATCHES &&
        packetIndex.duplicate_probe_indexes === 0 &&
        pendingIndexes === 0 &&
        completeIndexes === TARGET_BATCHES &&
        (packetIndex.status === BATCH_INDEX_ALIGNMENT.TERMINAL_PASS ||
          packetIndex.status === BATCH_INDEX_ALIGNMENT.ALIGNED ||
          packetIndex.status === 'PASS') &&
        observed.ACTIVE_TRANSIENT_LEAD >= 1 &&
        observed.ALIGNED >= 1 &&
        (capture?.drops ?? 0) === 0 &&
        capture?.segment_continuity !== false;

      const report = {
        status: pass ? 'PASS' : 'BLOCKED',
        out: opts.out,
        run_id: runId,
        launch_head: launchHead,
        manifest_sha256: sha256File(manifestPath),
        matrix_result: matrixResult,
        http_200: http200,
        http_422: http422,
        queue,
        packet_index: packetIndex,
        pending_batch_indexes: pendingIndexes,
        complete_batch_indexes: completeIndexes,
        observed_alignments: observed,
        summary_status: summary.status,
        summary_status_note: summary.summary_status_note,
        capture_drops: capture?.drops ?? null,
        capture_continuity: capture?.segment_continuity ?? null,
        target_batches: TARGET_BATCHES,
        target_probes: TARGET_PROBES,
      };
      fs.writeFileSync(
        path.join(opts.out, 'phase32h-r1-packet-index-lifecycle-smoke.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );

      // Extra drain pass: collector stop can race with final PCAP/supervisor children.
      let cleanup = stopRootScopedCollectors(opts.out, { repoRoot: REPO_ROOT, gracefulMs: 20_000 });
      for (let i = 0; i < 10 && !cleanup.zero_root_scoped; i += 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        cleanup = stopRootScopedCollectors(opts.out, { repoRoot: REPO_ROOT, gracefulMs: 10_000 });
      }

      let shutdown;
      try {
        shutdown = finalizeSmokeWithFreeze(opts.out, {
          repoRoot: REPO_ROOT,
          pass,
          hashManifestName: 'phase32h-r1-packet-index-lifecycle-smoke-sha256.txt',
          hashExcludeSuffixes: [
            'phase32h-r1-packet-index-lifecycle-smoke-sha256.txt',
            'FROZEN_PASS_EVIDENCE',
          ],
          markerName: 'FROZEN_PASS_EVIDENCE',
          markerContent: `${new Date().toISOString()}\nPACKET_INDEX_LIFECYCLE_SMOKE_PASS\n`,
          jsonlPaths: ['h1', 'h2', 'h3'].map((s) =>
            path.join(opts.out, `shard-${s}`, 'phase32h-matrix.jsonl'),
          ),
          gracefulMs: 20_000,
        });
      } catch (err) {
        cleanup = stopRootScopedCollectors(opts.out, { repoRoot: REPO_ROOT, gracefulMs: 20_000 });
        const freeze = executeFreezeIntegrity({
          outRoot: opts.out,
          repoRoot: REPO_ROOT,
          quietPeriodMs: 5000,
          gracefulMs: 20_000,
          hashManifestName: 'phase32h-r1-packet-index-lifecycle-smoke-sha256.txt',
          hashExcludeSuffixes: [
            'phase32h-r1-packet-index-lifecycle-smoke-sha256.txt',
            'FROZEN_PASS_EVIDENCE',
          ],
          markerName: 'FROZEN_PASS_EVIDENCE',
          markerContent: `${new Date().toISOString()}\nPACKET_INDEX_LIFECYCLE_SMOKE_PASS\n`,
          jsonlPaths: ['h1', 'h2', 'h3'].map((s) =>
            path.join(opts.out, `shard-${s}`, 'phase32h-matrix.jsonl'),
          ),
          writersAlreadyStopped: true,
        });
        shutdown = {
          cleanup,
          freeze,
          freezeReady: true,
          queue_terminal: true,
          freeze_retry: true,
          freeze_first_error: err.message,
        };
      }
      report.shutdown = shutdown;
      report.processes_remaining = listRootScopedProcesses(opts.out).length;
      report.open_writers = verifyOpenFiles(opts.out).open_files_remaining;
      report.marker_present = fs.existsSync(path.join(opts.out, 'FROZEN_PASS_EVIDENCE'));

      const finalSummary = buildPhase32hSummary(opts.out, loadShardRows(opts.out));
      report.final_summary = {
        status: finalSummary.status,
        summary_status_note: finalSummary.summary_status_note,
        freeze_complete: finalSummary.freeze_complete,
        frozen_evidence: finalSummary.frozen_evidence,
      };

      console.log(JSON.stringify(report, null, 2));
      const ok =
        pass &&
        Boolean(shutdown?.freeze) &&
        shutdown.freeze?.marker_written_last !== false &&
        report.processes_remaining === 0 &&
        (report.open_writers === 0 || report.open_writers == null) &&
        finalSummary.status === 'PASS' &&
        finalSummary.summary_status_note === 'PASS' &&
        report.marker_present;
      process.exit(ok ? 0 : 2);
    },
    { repoRoot: REPO_ROOT, skipCleanup: true },
  );
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
