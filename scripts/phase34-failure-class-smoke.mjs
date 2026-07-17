#!/usr/bin/env node
/**
 * Phase 34 failure-class smoke: proves HTTP 502 / HTTP 0 fail logical sessions,
 * queue can still terminate, and bounded blocked freeze succeeds.
 *
 * Usage:
 *   node scripts/phase34-failure-class-smoke.mjs --out /tmp/phase34-live-inference-failure-smoke-v1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBoundedFinalization,
  evaluateProtocolAcceptance,
  writeBoundedFinalizationReports,
} from './lib/phase34-bounded-finalization.mjs';
import { finalizePhase33fRun } from './lib/phase33f-run-finalize.mjs';
import { summarizeRunnerResult } from './lib/phase33f-human-checkpoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: '/tmp/phase34-live-inference-failure-smoke-v1' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function writeMatrix(out, rowsByShard) {
  for (const [shard, rows] of Object.entries(rowsByShard)) {
    const dir = path.join(out, `shard-${shard}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'phase33f-matrix.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (fs.existsSync(opts.out)) {
    throw new Error(`evidence root must be absent: ${opts.out}`);
  }
  fs.mkdirSync(opts.out, { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'run-state'), { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'run-state', 'run-id'), 'phase34-failure-smoke\n');
  fs.writeFileSync(
    path.join(opts.out, 'run-state', 'collector-registry.json'),
    `${JSON.stringify({ collectors: { pcap_collector: { status: 'absent_by_design' } } })}\n`,
  );

  const rows = {
    h1: [
      { probe_id: 'b1_h1', batch_id: 'b1', capability: 'valuation', protocol: 'h1', ok: true, http_status: 200 },
      { probe_id: 'b2_h1', batch_id: 'b2', capability: 'market_analytics', protocol: 'h1', ok: true, http_status: 200 },
    ],
    h2: [
      { probe_id: 'b1_h2', batch_id: 'b1', capability: 'valuation', protocol: 'h2', ok: false, http_status: 502 },
      { probe_id: 'b2_h2', batch_id: 'b2', capability: 'market_analytics', protocol: 'h2', ok: true, http_status: 200 },
    ],
    h3: [
      { probe_id: 'b1_h3', batch_id: 'b1', capability: 'valuation', protocol: 'h3', ok: true, http_status: 200 },
      {
        probe_id: 'b2_h3',
        batch_id: 'b2',
        capability: 'market_analytics',
        protocol: 'h3',
        ok: false,
        http_status: 0,
        error_class: 'curl_exit',
      },
    ],
  };
  writeMatrix(opts.out, rows);
  fs.writeFileSync(
    path.join(opts.out, 'run-state', 'correlation-queue.json'),
    `${JSON.stringify({
      schema_version: 2,
      run_id: 'phase34-failure-smoke',
      launch_head: 'smoke',
      manifest_sha: 'smoke',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      complete_total: 2,
      failed_total: 0,
      failed_summaries: [],
      jobs: [],
      stats: {
        pending_count: 0,
        running_count: 0,
        complete_count: 2,
        failed_count: 0,
        unresolved_count: 0,
        oldest_pending_age_ms: null,
        oldest_pending_enqueued_at: null,
      },
      metrics: {
        enqueue_rate_jobs_per_minute: null,
        drain_rate_jobs_per_minute: 0,
        last_drain_at: new Date().toISOString(),
        last_enqueue_at: new Date().toISOString(),
      },
    })}\n`,
  );

  const unit = evaluateProtocolAcceptance({
    queue: { complete_count: 2, failed_count: 0 },
    protocolRows: [...rows.h1, ...rows.h2, ...rows.h3],
  });
  if (unit.status !== 'BLOCKED' || unit.http_502 !== 1 || unit.http_0 !== 1 || unit.logical_sessions_fail !== 2) {
    throw new Error(`unexpected unit acceptance: ${JSON.stringify(unit)}`);
  }

  const built = buildBoundedFinalization(opts.out, {
    expectedLogicalSessions: 2,
    expectedProtocolRows: 6,
    runnerSummary: summarizeRunnerResult({
      status: 'FAIL',
      batches: 2,
      probes: 6,
      ok_count: 4,
      fail_count: 2,
      batch_results: [{ body: 'must-not-appear' }],
    }),
  });
  const written = writeBoundedFinalizationReports(opts.out, built);
  if (JSON.stringify(built.summary).includes('must-not-appear')) {
    throw new Error('summary leaked batch payloads');
  }

  const freeze = finalizePhase33fRun({
    outRoot: opts.out,
    repoRoot: REPO_ROOT,
    status: 'BLOCKED',
    failureClass: 'PROTOCOL_ROW_FAILURE',
    failureDetails: {
      acceptance: built.acceptance,
      failures: built.failures,
      summary_path: path.relative(opts.out, written.summaryPath),
    },
    mode: 'phase34-failure-smoke',
    launchHead: 'smoke',
    manifestSha: 'smoke',
    runner: built.summary.runner,
    verdict: { status: 'FAIL', acceptance: built.acceptance },
    quietPeriodMs: 1000,
    gracefulMs: 2000,
  });

  const marker = path.join(opts.out, 'FROZEN_BLOCKED_EVIDENCE');
  if (!fs.existsSync(marker)) throw new Error('missing FROZEN_BLOCKED_EVIDENCE');
  if (fs.existsSync(path.join(opts.out, 'FROZEN_PASS_EVIDENCE'))) {
    throw new Error('PASS marker must not exist');
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        out: opts.out,
        acceptance: built.acceptance,
        summary_bytes: written.summaryBytes,
        freeze: freeze.status,
        marker: 'FROZEN_BLOCKED_EVIDENCE',
      },
      null,
      2,
    ),
  );
}

main();
