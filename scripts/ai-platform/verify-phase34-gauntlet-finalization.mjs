#!/usr/bin/env node
/**
 * Phase 34 gauntlet finalization verifier (offline + optional 60k soak).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FINAL_SUMMARY_MAX_BYTES,
  buildBoundedFinalization,
  evaluateProtocolAcceptance,
  writeBoundedFinalizationReports,
} from '../lib/phase34-bounded-finalization.mjs';
import {
  formatHumanCheckpointLine,
  shouldEmitHumanCheckpoint,
  summarizeRunnerResult,
} from '../lib/phase33f-human-checkpoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function probe(batchId, capability, protocol, opts = {}) {
  return {
    probe_id: `${batchId}_${protocol}`,
    batch_id: batchId,
    capability,
    protocol,
    ok: opts.ok !== false,
    http_status: opts.httpStatus ?? 200,
    error_class: opts.errorClass || null,
  };
}

function writeSyntheticRoot(outRoot, { batches, failAt = [] } = {}) {
  fs.mkdirSync(outRoot, { recursive: true });
  const failSet = new Set(failAt.map((f) => `${f.batch}:${f.protocol}`));
  for (const shard of ['h1', 'h2', 'h3']) {
    const lines = [];
    for (let i = 1; i <= batches; i += 1) {
      const batch = `batch_${String(i).padStart(5, '0')}_scarcity`;
      const key = `${batch}:${shard}`;
      const failed = failSet.has(key);
      lines.push(
        JSON.stringify(
          probe(batch, 'scarcity', shard, {
            ok: !failed,
            httpStatus: failed ? (shard === 'h3' && failAt.find((f) => f.batch === batch && f.protocol === 'h3' && f.http0) ? 0 : 502) : 200,
            errorClass: failed && failAt.find((f) => f.batch === batch)?.errorClass,
          }),
        ),
      );
    }
    const dir = path.join(outRoot, `shard-${shard}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'phase33f-matrix.jsonl'), `${lines.join('\n')}\n`);
  }
  fs.mkdirSync(path.join(outRoot, 'run-state'), { recursive: true });
  fs.writeFileSync(
    path.join(outRoot, 'run-state', 'correlation-queue.json'),
    `${JSON.stringify({
      complete_total: batches,
      failed_total: 0,
      stats: { pending_count: 0, running_count: 0, complete_count: batches, failed_count: 0 },
    })}\n`,
  );
}

function main() {
  const unit = spawnSync(process.execPath, ['--test', 'tests/phase34-bounded-finalization.test.mjs', 'tests/phase33f-runner-checkpoints.test.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (unit.status !== 0) {
    console.error(unit.stdout || unit.stderr);
    process.exit(unit.status || 1);
  }

  // Contract: queue COMPLETE cannot mask protocol failures
  const blocked = evaluateProtocolAcceptance({
    queue: { complete_count: 1, failed_count: 0 },
    protocolRows: [
      probe('b', 'valuation', 'h1'),
      probe('b', 'valuation', 'h2', { ok: false, httpStatus: 502 }),
      probe('b', 'valuation', 'h3'),
    ],
    runner: { status: 'PASS', fail_count: 0 },
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.pass_impossible_with_protocol_failures, true);

  // Checkpoint boundedness
  assert.equal(shouldEmitHumanCheckpoint({ completed: 500, lastCompleted: 0, nowMs: 1, lastAtMs: 0 }), true);
  const line = formatHumanCheckpointLine({
    status: 'ADVANCING',
    completed: 500,
    target: 20000,
    failed: 0,
    startedAtMs: 0,
    nowMs: 600000,
    previousCompleted: 0,
    previousAtMs: 0,
    queue: { pending_count: 0, running_count: 0, complete_count: 500, failed_count: 0 },
  });
  assert.match(line, /^PHASE34_CHECKPOINT /);
  assert.ok(line.length < 1200);

  // 60k-row soak under constrained heap (synthetic)
  const soakRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-final-soak-'));
  try {
    const failAt = [
      { batch: 'batch_03009_scarcity', protocol: 'h2' },
      { batch: 'batch_03009_scarcity', protocol: 'h3' },
      { batch: 'batch_03095_scarcity', protocol: 'h2' },
      { batch: 'batch_03095_scarcity', protocol: 'h3' },
      { batch: 'batch_02656_scarcity', protocol: 'h3' },
      { batch: 'batch_19430_scarcity', protocol: 'h3', http0: true, errorClass: 'curl_exit' },
    ];
    writeSyntheticRoot(soakRoot, { batches: 20000, failAt });
    const built = buildBoundedFinalization(soakRoot, {
      expectedLogicalSessions: 20000,
      expectedProtocolRows: 60000,
      runnerSummary: summarizeRunnerResult({
        status: 'PASS',
        batches: 20000,
        probes: 60000,
        ok_count: 59994,
        fail_count: 6,
        batch_results: [{ huge: 'should-not-serialize' }],
      }),
    });
    assert.equal(built.acceptance.protocol_rows_complete, 60000);
    assert.equal(built.acceptance.protocol_rows_fail, 6);
    assert.equal(built.acceptance.logical_sessions_complete, 20000);
    assert.equal(built.acceptance.status, 'BLOCKED');
    assert.ok(!JSON.stringify(built.summary).includes('should-not-serialize'));
    const written = writeBoundedFinalizationReports(soakRoot, built);
    assert.ok(written.summaryBytes <= FINAL_SUMMARY_MAX_BYTES);
    assert.ok(fs.existsSync(written.failureIndexPath));
    const failLines = fs.readFileSync(written.failureIndexPath, 'utf8').trim().split('\n');
    assert.equal(failLines.length, 6);

    // zero-failure PASS path
    const passRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-final-pass-'));
    writeSyntheticRoot(passRoot, { batches: 100 });
    const passBuilt = buildBoundedFinalization(passRoot, {
      expectedLogicalSessions: 100,
      expectedProtocolRows: 300,
    });
    assert.equal(passBuilt.acceptance.status, 'PASS');
    writeBoundedFinalizationReports(passRoot, passBuilt);
    fs.rmSync(passRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(soakRoot, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        verifier: 'verify-phase34-gauntlet-finalization',
        final_summary_max_bytes: FINAL_SUMMARY_MAX_BYTES,
        soak: { logical: 20000, protocol: 60000, injected_failures: 6 },
      },
      null,
      2,
    ),
  );
}

main();
