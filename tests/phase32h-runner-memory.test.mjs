import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  parseSingleJsonDocument,
  JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT,
  writeAtomicJsonFile,
  readSingleJsonFile,
} from '../scripts/lib/phase32h-json-document.mjs';
import {
  iterateJsonlFile,
  countJsonlRowsStreamingSync,
  detectTruncatedJsonlStreaming,
  sourceAvoidsWholeFileSplit,
  JSONL_MALFORMED_LINE,
  JSONL_TRUNCATED_FINAL,
  JSONL_LINE_TOO_LONG,
} from '../scripts/lib/phase32h-jsonl-stream.mjs';
import { BoundedWorkerPool, capBuffer } from '../scripts/lib/phase32h-worker-pool.mjs';
import {
  initCorrelationQueue,
  finalizeTripletCorrelationJob,
  getActiveQueueMemoryJobs,
  readCorrelationQueue,
  recoverStaleRunningJobs,
  claimCorrelationJob,
  JOB_STATUS,
  writeCorrelationQueue,
  correlationQueueHistoryPath,
} from '../scripts/lib/phase32h-correlation-queue.mjs';
import { batchIndexPath, writeBatchPacketIndex } from '../scripts/lib/phase32h-batch-packet-index.mjs';
import { writeProbePacketIndex } from '../scripts/lib/phase32h-probe-packet-index.mjs';
import {
  initRunState,
  assertAppendAllowed,
  recordCompletedProbe,
  ensureProbeIndexCache,
  clearProbeIndexCache,
  loadProbeIndex,
  countJsonlRows,
  detectTruncatedJsonl,
} from '../scripts/lib/phase32h-run-integrity.mjs';
import {
  roleForCommand,
  classifyProcessForFreeze,
  verifyZeroWriters,
  verifyOpenFiles,
  listRootScopedProcesses,
} from '../scripts/lib/phase32h-freeze-integrity.mjs';
import crypto from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = 'phase32h-mem-test';
const LAUNCH_HEAD = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const MANIFEST_SHA = crypto.createHash('sha256').update('manifest').digest('hex');

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-mem-'));
  fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'phase32h-r1-manifest.jsonl'), '{}\n', 'utf8');
  initRunState(root, {
    runId: RUN_ID,
    launchHead: LAUNCH_HEAD,
    evidenceLabel: 'mem-test',
    manifestPath: path.join(root, 'phase32h-r1-manifest.jsonl'),
  });
  initCorrelationQueue(root, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA });
  return root;
}

describe('phase32h runner memory — JSONL streaming', () => {
  it('streams 100,000 JSONL rows without whole-file split in library source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-jsonl-'));
    const file = path.join(root, 'big.jsonl');
    const fd = fs.openSync(file, 'w');
    for (let i = 0; i < 100_000; i += 1) {
      fs.writeSync(fd, `{"i":${i}}\n`);
    }
    fs.closeSync(fd);
    let count = 0;
    for await (const { value } of iterateJsonlFile(file)) {
      count += 1;
      assert.equal(typeof value.i, 'number');
    }
    assert.equal(count, 100_000);
    assert.equal(countJsonlRowsStreamingSync(file), 100_000);
    const src = fs.readFileSync(path.join(REPO, 'scripts/lib/phase32h-jsonl-stream.mjs'), 'utf8');
    assert.equal(sourceAvoidsWholeFileSplit(src), true);
    assert.equal(src.includes("readFileSync") && src.includes(".split("), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('malformed middle line includes exact line number', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-jsonl-'));
    const file = path.join(root, 'bad.jsonl');
    fs.writeFileSync(file, '{"ok":1}\n{not-json}\n{"ok":3}\n', 'utf8');
    await assert.rejects(
      async () => {
        for await (const _ of iterateJsonlFile(file)) {
          // drain
        }
      },
      (err) => err.code === JSONL_MALFORMED_LINE && err.lineNumber === 2,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('truncated final line fails with explicit policy', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-jsonl-'));
    const file = path.join(root, 'trunc.jsonl');
    fs.writeFileSync(file, '{"ok":1}\n{"partial":', 'utf8');
    assert.throws(
      () => countJsonlRowsStreamingSync(file, { truncatedFinal: 'error' }),
      (err) => err.code === JSONL_TRUNCATED_FINAL,
    );
    assert.equal(detectTruncatedJsonlStreaming(file), true);
    assert.equal(detectTruncatedJsonl(file), true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('blank lines skipped; max line size enforced', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-jsonl-'));
    const file = path.join(root, 'blank.jsonl');
    fs.writeFileSync(file, '{"a":1}\n\n{"b":2}\n', 'utf8');
    let n = 0;
    for await (const _ of iterateJsonlFile(file, { onBlankLine: 'skip' })) n += 1;
    assert.equal(n, 2);
    const long = path.join(root, 'long.jsonl');
    fs.writeFileSync(long, `{"x":"${'y'.repeat(200)}"}\n`, 'utf8');
    assert.throws(
      () => countJsonlRowsStreamingSync(long, { maxLineBytes: 32 }),
      (err) => err.code === JSONL_LINE_TOO_LONG,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('incremental counters equal reference scan', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-jsonl-'));
    const file = path.join(root, 'ref.jsonl');
    const rows = [];
    for (let i = 0; i < 500; i += 1) rows.push(JSON.stringify({ i }));
    fs.writeFileSync(file, `${rows.join('\n')}\n`, 'utf8');
    const streamed = countJsonlRowsStreamingSync(file);
    const reference = rows.length;
    assert.equal(streamed, reference);
    assert.equal(countJsonlRows(file), reference);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('phase32h runner memory — JSON document contracts', () => {
  it('accepts single JSON and trailing whitespace', () => {
    assert.deepEqual(parseSingleJsonDocument('{"a":1}\n  '), { a: 1 });
  });

  it('rejects two adjacent JSON documents', () => {
    assert.throws(
      () => parseSingleJsonDocument('{}\n{}'),
      (err) => err.code === JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT,
    );
  });

  it('atomic status JSON replacement', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-json-'));
    const file = path.join(root, 'status.json');
    writeAtomicJsonFile(file, { v: 1 });
    writeAtomicJsonFile(file, { v: 2 });
    assert.deepEqual(readSingleJsonFile(file), { v: 2 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('parse CLI: stdout JSON only; stderr diagnostics do not corrupt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-json-'));
    const file = path.join(root, 'summary.json');
    fs.writeFileSync(file, '{"total":3,"status":"IN_PROGRESS"}\n', 'utf8');
    const cli = path.join(REPO, 'scripts/phase32h-parse-summary-json.mjs');
    const res = spawnSync(process.execPath, [cli, '--file', file], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.total, 3);
    assert.equal((res.stderr || '').includes('{'), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('concatenated command outputs rejected', () => {
    assert.throws(
      () => parseSingleJsonDocument('{"a":1}{"b":2}'),
      (err) => err.code === JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT,
    );
  });
});

describe('phase32h runner memory — queue bounds', () => {
  let root;
  beforeEach(() => {
    root = mkRoot();
  });
  afterEach(() => {
    clearProbeIndexCache?.(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeIndexes(batchNum) {
    const batchId = `batch-mem-${batchNum}`;
    const probeIds = { h1: batchNum * 10 + 1, h2: batchNum * 10 + 2, h3: batchNum * 10 + 3 };
    writeBatchPacketIndex(root, {
      batch_id: batchId,
      run_id: RUN_ID,
      member_probe_ids: probeIds,
      coordinate: { case_id: 'c', window: 1, run: 1, user_uid: 'u', user_class: 'real_participant' },
      start_spread_ms: 1,
      batch_timing_status: 'PASS',
      packet_correlation_status: 'PENDING',
    });
    for (const [proto, probeId] of Object.entries(probeIds)) {
      writeProbePacketIndex(root, probeId, {
        probe_id: probeId,
        batch_id: batchId,
        protocol: proto,
        run_id: RUN_ID,
        launch_head: LAUNCH_HEAD,
        correlation_status: 'PARTIAL',
      });
    }
    return finalizeTripletCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
  }

  it('active queue remains bounded over 10,000 batches; COMPLETE not in active memory', () => {
    for (let i = 1; i <= 10_000; i += 1) writeIndexes(i);
    const queue = readCorrelationQueue(root);
    const active = getActiveQueueMemoryJobs(queue);
    assert.equal(active.length, 0);
    assert.equal(queue.jobs.length, 0);
    assert.equal(queue.stats.complete_count, 10_000);
    assert.equal(queue.complete_total, 10_000);
    assert.ok(fs.existsSync(correlationQueueHistoryPath(root)));
    const histLines = fs.readFileSync(correlationQueueHistoryPath(root), 'utf8').trim().split('\n');
    assert.equal(histLines.length, 10_000);
  });

  it('stale RUNNING recovery and malformed queue fail-closed', () => {
    writeIndexes(1);
    // create stale running
    const queue = readCorrelationQueue(root);
    queue.jobs.push({
      job_id: 'corr-stale',
      batch_id: 'batch-stale',
      run_id: RUN_ID,
      launch_head: LAUNCH_HEAD,
      manifest_sha: MANIFEST_SHA,
      status: JOB_STATUS.RUNNING,
      enqueued_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      attempt_count: 1,
      expected_probe_ids: { h1: 1, h2: 2, h3: 3 },
      output_paths: { probe: {}, batch: batchIndexPath(root, 'missing') },
    });
    writeCorrelationQueue(root, queue);
    const recovered = recoverStaleRunningJobs(root, {
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
    });
    assert.ok(recovered.recovered >= 1);

    fs.writeFileSync(path.join(root, 'run-state', 'correlation-queue.json'), '{not-json', 'utf8');
    assert.throws(() => readCorrelationQueue(root));
  });
});

describe('phase32h runner memory — worker pool lifecycle', () => {
  it('bounds workers, terminates, listeners return to baseline', async () => {
    const script = path.join(REPO, 'scripts/lib/phase32h-triplet-probe-worker.mjs');
    // Use a tiny echo worker instead for unit isolation
    const echo = path.join(os.tmpdir(), `phase32h-echo-worker-${process.pid}.mjs`);
    fs.writeFileSync(
      echo,
      `
import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', (msg) => {
  if (msg?.type === 'job') parentPort.postMessage({ ok: true, echo: msg.payload });
});
`,
      'utf8',
    );
    const baselineHandles = process._getActiveHandles?.().length ?? 0;
    const pool = new BoundedWorkerPool({ workerScript: echo, size: 3 });
    assert.equal(pool.workerCount, 3);
    const results = [];
    for (let i = 0; i < 30; i += 1) {
      results.push(pool.runJob({ i }));
    }
    const settled = await Promise.all(results);
    assert.equal(settled.length, 30);
    assert.ok(pool.workerCount <= 3);
    assert.equal(pool.busyCount, 0);
    await pool.close();
    assert.equal(pool.workerCount, 0);
    const finalHandles = process._getActiveHandles?.().length ?? 0;
    assert.ok(finalHandles <= baselineHandles + 5, `handles grew too much: ${baselineHandles} -> ${finalHandles}`);
    fs.unlinkSync(echo);
  });

  it('child stdout/stderr caps enforced', () => {
    assert.throws(() => capBuffer(Buffer.alloc(100), 50, 'stdout'), (e) => e.code === 'CHILD_OUTPUT_CAP');
    assert.throws(() => capBuffer('x'.repeat(20), 10, 'stderr'), (e) => e.code === 'CHILD_OUTPUT_CAP');
    assert.equal(capBuffer('ok', 10, 'stdout').toString(), 'ok');
  });
});

describe('phase32h runner memory — probe index bounds', () => {
  let root;
  beforeEach(() => {
    root = mkRoot();
  });
  afterEach(() => {
    clearProbeIndexCache?.(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('duplicate detection after restart without retaining full payloads', () => {
    const probe = {
      probe_id: 42,
      matrix_protocol: 'h1',
      window: 1,
      user_class: 'real_participant',
      user_uid: 'u1',
      run: 1,
      case_id: 'c1',
    };
    const row = {
      ...probe,
      run_id: RUN_ID,
      git_sha: LAUNCH_HEAD,
      evidence_label: 'mem-test',
      timing: { probe_finished_at: new Date().toISOString() },
    };
    assertAppendAllowed(root, probe, row, {
      evidenceLabel: 'mem-test',
      launchHead: LAUNCH_HEAD,
      protocolKey: 'h1',
    });
    recordCompletedProbe(root, probe, row);
    clearProbeIndexCache(root);
    const cache = ensureProbeIndexCache(root);
    assert.equal(cache.probeIds.has(42), true);
    assert.throws(
      () =>
        assertAppendAllowed(root, probe, row, {
          evidenceLabel: 'mem-test',
          launchHead: LAUNCH_HEAD,
          protocolKey: 'h1',
        }),
      (err) => err.code === 'DUPLICATE_PROBE_ID',
    );
    const meta = loadProbeIndex(root);
    assert.ok(!Array.isArray(meta.probe_ids) || meta.probe_ids.length === 0 || meta.probe_count === 1);
  });
});

describe('phase32h runner memory — freeze identity', () => {
  it('freeze controller / echo / status CLI with root are not writers', () => {
    const root = '/tmp/phase32h-r1-baseline-r8';
    assert.equal(roleForCommand(`node /tmp/phase32h-freeze-r8-once.mjs`, root), null);
    assert.equal(roleForCommand(`bash -c 'echo ${root}'`, root), null);
    assert.equal(
      roleForCommand(`node scripts/phase32h-runtime-status-readonly.mjs --out ${root}`, root),
      null,
    );
    assert.equal(
      classifyProcessForFreeze(root, {
        pid: 1,
        command: `node --input-type=module -e "const OUT='${root}'"`,
      }).role,
      null,
    );
  });

  it('known dumpcap path role classified when present', () => {
    const root = '/tmp/phase32h-example-root';
    assert.equal(roleForCommand(`/usr/sbin/dumpcap -i en0 -w ${root}/pcap/cap.pcap`, root), 'pcap_collector');
  });
});
