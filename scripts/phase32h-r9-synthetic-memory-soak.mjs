#!/usr/bin/env node
/**
 * Synthetic bounded-memory soak: 10k triplet batches without real inference.
 * Exercises worker pool (echo workers), queue paging, probe index, telemetry, JSONL stream.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BoundedWorkerPool } from './lib/phase32h-worker-pool.mjs';
import { sampleMemoryTelemetry, appendMemoryTelemetry } from './lib/phase32h-memory-telemetry.mjs';
import {
  initCorrelationQueue,
  finalizeTripletCorrelationJob,
  getActiveQueueMemoryJobs,
  readCorrelationQueue,
  correlationQueueHistoryPath,
} from './lib/phase32h-correlation-queue.mjs';
import { writeBatchPacketIndex } from './lib/phase32h-batch-packet-index.mjs';
import { writeProbePacketIndex } from './lib/phase32h-probe-packet-index.mjs';
import {
  initRunState,
  assertAppendAllowed,
  recordCompletedProbe,
  clearProbeIndexCache,
  ensureProbeIndexCache,
} from './lib/phase32h-run-integrity.mjs';
import { countJsonlRowsStreamingSync } from './lib/phase32h-jsonl-stream.mjs';
import { parseSingleJsonDocument } from './lib/phase32h-json-document.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    out: '/tmp/phase32h-r9-memory-synthetic-v1',
    batches: 10000,
    telemetryEvery: 50,
    reportDir: '/tmp/phase32h-r9-repair',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--batches') opts.batches = Number(argv[++i]);
    if (argv[i] === '--telemetry-every') opts.telemetryEvery = Number(argv[++i]);
    if (argv[i] === '--report-dir') opts.reportDir = argv[++i];
  }
  return opts;
}

function linearSlope(samples, key) {
  if (samples.length < 4) return null;
  const half = samples.slice(Math.floor(samples.length / 2));
  const n = half.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = half[i][key];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return 0;
  return (n * sumXY - sumX * sumY) / den;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = opts.out;
  if (fs.existsSync(outRoot)) {
    throw new Error(`synthetic root must be absent: ${outRoot}`);
  }
  fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(opts.reportDir, { recursive: true });

  const RUN_ID = `phase32h-synth-${Date.now()}`;
  const LAUNCH_HEAD = '110a72649bb8dd7cfb537839b37abee8787a70ae';
  const MANIFEST_SHA = crypto.createHash('sha256').update('synth').digest('hex');
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-manifest.jsonl'), '{}\n', 'utf8');
  initRunState(outRoot, {
    runId: RUN_ID,
    launchHead: LAUNCH_HEAD,
    evidenceLabel: 'synthetic-memory',
    manifestPath: path.join(outRoot, 'phase32h-r1-manifest.jsonl'),
  });
  initCorrelationQueue(outRoot, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA });

  const echo = path.join(outRoot, 'echo-worker.mjs');
  fs.writeFileSync(
    echo,
    `import { parentPort } from 'node:worker_threads';
parentPort.on('message', (msg) => {
  if (msg?.type === 'job') parentPort.postMessage({ ok: true, n: msg.payload?.n ?? 0 });
});
`,
    'utf8',
  );

  const pool = new BoundedWorkerPool({ workerScript: echo, size: 3 });
  const timeseriesPath = path.join(opts.reportDir, 'synthetic-memory-timeseries.jsonl');
  fs.writeFileSync(timeseriesPath, '', 'utf8');

  const started = Date.now();
  const samples = [];
  const baseline = sampleMemoryTelemetry({
    batch_complete: 0,
    worker_count: pool.workerCount,
    message_port_count: pool.workerCount,
  });
  samples.push(baseline);
  fs.appendFileSync(timeseriesPath, `${JSON.stringify(baseline)}\n`);

  const ids = new Set();
  const coords = new Set();

  for (let batchNum = 1; batchNum <= opts.batches; batchNum += 1) {
    const batchId = `batch-synth-${batchNum}`;
    const probeIds = {
      h1: batchNum * 3 - 2,
      h2: batchNum * 3 - 1,
      h3: batchNum * 3,
    };

    // Worker pool exercise (3 jobs)
    await Promise.all([
      pool.runJob({ n: probeIds.h1 }),
      pool.runJob({ n: probeIds.h2 }),
      pool.runJob({ n: probeIds.h3 }),
    ]);

    writeBatchPacketIndex(outRoot, {
      batch_id: batchId,
      run_id: RUN_ID,
      member_probe_ids: probeIds,
      coordinate: { case_id: 'c', window: 1, run: 1, user_uid: 'u', user_class: 'real_participant' },
      start_spread_ms: 1,
      batch_timing_status: 'PASS',
      packet_correlation_status: 'PENDING',
    });
    for (const [proto, probeId] of Object.entries(probeIds)) {
      writeProbePacketIndex(outRoot, probeId, {
        probe_id: probeId,
        batch_id: batchId,
        protocol: proto,
        run_id: RUN_ID,
        launch_head: LAUNCH_HEAD,
        correlation_status: 'PARTIAL',
      });
      const probe = {
        probe_id: probeId,
        matrix_protocol: proto,
        window: 1,
        user_class: 'real_participant',
        user_uid: `u${probeId}`,
        run: 1,
        case_id: 'c',
      };
      const row = {
        ...probe,
        run_id: RUN_ID,
        git_sha: LAUNCH_HEAD,
        evidence_label: 'synthetic-memory',
        timing: { probe_finished_at: new Date().toISOString() },
      };
      assertAppendAllowed(outRoot, probe, row, {
        evidenceLabel: 'synthetic-memory',
        launchHead: LAUNCH_HEAD,
        protocolKey: proto,
      });
      recordCompletedProbe(outRoot, probe, row);
      if (ids.has(probeId)) throw new Error(`duplicate id ${probeId}`);
      ids.add(probeId);
      const coord = `${proto}|1|real_participant|`;
      coords.add(coord);
      fs.mkdirSync(path.join(outRoot, `shard-${proto}`), { recursive: true });
      fs.appendFileSync(
        path.join(outRoot, `shard-${proto}`, 'phase32h-matrix.jsonl'),
        `${JSON.stringify({ probe_id: probeId, batch_id: batchId, http_status: 200 })}\n`,
      );
    }

    finalizeTripletCorrelationJob(outRoot, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });

    if (batchNum % opts.telemetryEvery === 0 || batchNum === opts.batches) {
      const queue = readCorrelationQueue(outRoot);
      const sample = sampleMemoryTelemetry({
        batch_complete: batchNum,
        probe_total: batchNum * 3,
        worker_count: pool.workerCount,
        message_port_count: pool.workerCount,
        worker_queue_depth: pool.queueDepth,
        queue_pending: queue.stats.pending_count,
        queue_running: queue.stats.running_count,
        queue_complete_total: queue.stats.complete_count,
      });
      samples.push(sample);
      fs.appendFileSync(timeseriesPath, `${JSON.stringify(sample)}\n`);
      appendMemoryTelemetry(outRoot, sample);
      if (getActiveQueueMemoryJobs(queue).length > 0) {
        throw new Error(`active queue not drained at batch ${batchNum}`);
      }
      if (pool.busyCount !== 0) throw new Error(`busy workers at batch ${batchNum}`);
    }
  }

  await pool.close();
  clearProbeIndexCache(outRoot);

  // Parser contract self-check
  parseSingleJsonDocument('{"ok":1}\n');
  try {
    parseSingleJsonDocument('{}\n{}');
    throw new Error('adjacent JSON should fail');
  } catch (err) {
    if (err.code !== 'JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT') throw err;
  }

  const queue = readCorrelationQueue(outRoot);
  const hist = countJsonlRowsStreamingSync(correlationQueueHistoryPath(outRoot));
  const cache = ensureProbeIndexCache(outRoot);
  const final = samples[samples.length - 1];
  const peakHeap = Math.max(...samples.map((s) => s.heap_used_mb));
  const peakRss = Math.max(...samples.map((s) => s.rss_mb));
  const heapSlope = linearSlope(samples, 'heap_used_mb');
  const rssSlope = linearSlope(samples, 'rss_mb');

  const report = {
    status:
      queue.stats.complete_count === opts.batches &&
      hist === opts.batches &&
      cache.probeIds.size === opts.batches * 3 &&
      pool.workerCount === 0 &&
      (heapSlope == null || heapSlope < 0.05)
        ? 'PASS'
        : 'BLOCKED',
    out_root: outRoot,
    batches: opts.batches,
    queue_complete_total: queue.stats.complete_count,
    queue_pending: queue.stats.pending_count,
    queue_running: queue.stats.running_count,
    history_rows: hist,
    probe_ids: cache.probeIds.size,
    worker_baseline: baseline.worker_count,
    worker_final: 0,
    worker_peak: 3,
    message_port_baseline: baseline.message_port_count,
    message_port_final: 0,
    initial_heap_mb: baseline.heap_used_mb,
    peak_heap_mb: peakHeap,
    final_heap_mb: final.heap_used_mb,
    initial_rss_mb: baseline.rss_mb,
    peak_rss_mb: peakRss,
    final_rss_mb: final.rss_mb,
    final_half_heap_slope_mb_per_sample: heapSlope,
    final_half_rss_slope_mb_per_sample: rssSlope,
    active_handles_initial: baseline.active_handles,
    active_handles_final: final.active_handles,
    elapsed_ms: Date.now() - started,
    node_options: process.env.NODE_OPTIONS || null,
  };

  if (report.status !== 'PASS') {
    report.block_reasons = [];
    if (queue.stats.complete_count !== opts.batches) report.block_reasons.push('queue_complete_mismatch');
    if (hist !== opts.batches) report.block_reasons.push('history_mismatch');
    if (cache.probeIds.size !== opts.batches * 3) report.block_reasons.push('probe_index_mismatch');
    if (heapSlope != null && heapSlope >= 0.05) report.block_reasons.push('heap_slope_positive');
  }

  fs.writeFileSync(path.join(opts.reportDir, 'synthetic-memory-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(opts.reportDir, 'synthetic-memory-report.md'),
    `# Synthetic memory soak\n\nstatus=${report.status}\nbatches=${report.batches}\nheap ${report.initial_heap_mb}/${report.peak_heap_mb}/${report.final_heap_mb}\nrss ${report.initial_rss_mb}/${report.peak_rss_mb}/${report.final_rss_mb}\nheap_slope=${report.final_half_heap_slope_mb_per_sample}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
