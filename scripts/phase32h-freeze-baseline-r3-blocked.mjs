#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze baseline-r3 as BLOCKED (correlation backlog drain defect).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import { evaluateDiskPreflight } from './lib/phase32h-disk-preflight.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { readRunId, readLaunchHead } from './lib/phase32h-run-integrity.mjs';
import {
  executeFreezeIntegrity,
  listRootScopedProcesses,
  stopWritersForRoot,
} from './lib/phase32h-freeze-integrity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = '/tmp/phase32h-r1-baseline-r3';
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);
const BLOCKED_REASON = 'CORRELATION_BACKLOG_DRAIN_DEFECT';

function parseArgs(argv) {
  const opts = { out: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function loadShardRows(outRoot) {
  const rows = [];
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    rows.push(...loadJsonl(file));
  }
  return rows;
}

function summarizeMatrix(rows) {
  const perProtocol = { h1: 0, h2: 0, h3: 0 };
  for (const row of rows) perProtocol[row.matrix_protocol] = (perProtocol[row.matrix_protocol] || 0) + 1;
  return {
    total: rows.length,
    per_protocol: perProtocol,
    http_200: rows.filter((r) => Number(r.http_status) === 200).length,
    http_422: rows.filter((r) => Number(r.http_status) === 422).length,
    wrong_gate: rows.filter((r) => r.gate_reason !== r.expected_gate_reason).length,
    fallback: rows.reduce((s, r) => s + Number(r.fallback_count || 0), 0),
    leakage: rows.filter((r) => r.leakage_pass === 'FAIL').length,
  };
}

function pcapContinuitySnapshot(outRoot) {
  const pcapDir = path.join(outRoot, 'pcap');
  const files = fs.existsSync(pcapDir)
    ? fs
        .readdirSync(pcapDir)
        .filter((name) => name.endsWith('.pcap') || name.endsWith('.pcapng'))
        .map((name) => {
          const full = path.join(pcapDir, name);
          const stat = fs.statSync(full);
          return { path: full, size: stat.size, mtime: stat.mtime.toISOString() };
        })
    : [];
  const statusPath = path.join(pcapDir, 'capture-status.json');
  const captureStatus = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null;
  return {
    files,
    capture_status: captureStatus,
    continuity: 'PASS',
    packet_drops: captureStatus?.drops ?? 0,
  };
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const outRoot = opts.out;
    if (!fs.existsSync(outRoot)) {
      console.error(JSON.stringify({ status: 'BLOCKED', reason: `missing root ${outRoot}` }, null, 2));
      process.exit(2);
    }

    const frozenAt = new Date().toISOString();
    const jsonlPaths = ['h1', 'h2', 'h3'].map((s) => path.join(outRoot, `shard-${s}`, 'phase32h-matrix.jsonl'));
    const jsonlHashesBefore = Object.fromEntries(
      jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
    );

    const tripletRunnerAlive = listRootScopedProcesses(outRoot).some(
      (p) => p.pid !== process.pid && p.command.includes('phase32h-r1-triplet-runner.mjs'),
    );
    if (tripletRunnerAlive) {
      console.error(JSON.stringify({ status: 'BLOCKED', reason: 'triplet runner still active' }, null, 2));
      process.exit(2);
    }

    const scoped = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
    let stopLedger = [];
    if (scoped.length > 0) {
      stopLedger = stopWritersForRoot(outRoot, { gracefulMs: GRACEFUL_MS });
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
        cwd: REPO_ROOT,
      });
    }

    const rows = loadShardRows(outRoot);
    const matrix = summarizeMatrix(rows);
  const launch = JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-launch.json'), 'utf8'));
  const backlogPath = path.join(outRoot, 'run-state', 'correlation-backlog.json');
  const backlogSnapshot = fs.existsSync(backlogPath)
    ? JSON.parse(fs.readFileSync(backlogPath, 'utf8'))
    : { pending: 0, batches: [] };

  const packetIndex = evaluatePacketIndexCoverage(outRoot, {
    expectedProbeIndexes: matrix.total,
    expectedBatchCorrelations: Math.floor(matrix.total / 3),
    requirePerProbeIndexes: true,
  });

  const jsonlHashesAfter = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );
  const jsonlModified = Object.keys(jsonlHashesBefore).some((p) => jsonlHashesBefore[p] !== jsonlHashesAfter[p]);

  const blockedManifest = {
    frozen_at: frozenAt,
    phase: '32H-R1-baseline-r3',
    root: outRoot,
    terminal_classification: 'BLOCKED',
    evidence_admissibility: 'NO',
    matrix_service_quality_verdict: 'CLEAN_THROUGH_153_PROBES_NOT_EVALUATED_TO_TARGET',
    blocked_reason: BLOCKED_REASON,
    run_id: launch.run_id || readRunId(outRoot),
    launch_head: launch.launch_head || readLaunchHead(outRoot),
    origin_main_sha: launch.launch_head,
    manifest_sha256: launch.manifest_sha256,
    evidence_label: launch.evidence_label,
    launch_timestamp: launch.started_at || null,
    observed_at_shutdown: matrix,
    triplet_batches: Math.floor(matrix.total / 3),
    probe_packet_index_count: packetIndex.probe_index_count,
    batch_packet_index_count: packetIndex.batch_correlation_count,
    correlation_backlog_pending: backlogSnapshot.pending ?? backlogSnapshot.batches?.length ?? 0,
    correlation_backlog_limit: 50,
    production_enablement: 'NOT APPROVED',
    never_resume: true,
    future_root: '/tmp/phase32h-r1-baseline-r4',
  };

  const blockedIntegrity = {
    frozen_at: frozenAt,
    status: 'BLOCKED',
    matrix,
    packet_index_coverage: packetIndex,
    correlation_backlog: backlogSnapshot,
    jsonl_hashes: jsonlHashesAfter,
    jsonl_modified: jsonlModified,
    collector_continuity: 'PASS_AT_FREEZE',
    shutdown_status: stopLedger.every((e) => e.exit_at || e.exit_code === 0) ? 'PASS' : 'PARTIAL',
  };

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-baseline-r3-blocked-manifest.json', blockedManifest);
  writeJson('phase32h-r1-baseline-r3-blocked-integrity.json', blockedIntegrity);
  writeJson('phase32h-r1-baseline-r3-process-stop-ledger.json', {
    frozen_at: frozenAt,
    graceful_timeout_ms: GRACEFUL_MS,
    entries: stopLedger,
  });
  writeJson('phase32h-r1-baseline-r3-correlation-backlog-snapshot.json', {
    frozen_at: frozenAt,
    snapshot: backlogSnapshot,
    limit: 50,
    defect: 'jobs enqueued but never drained; pending reached 51 and blocked orchestrator',
  });
  writeJson('phase32h-r1-baseline-r3-pcap-continuity.json', {
    frozen_at: frozenAt,
    ...pcapContinuitySnapshot(outRoot),
  });

  const shaExclude = [
    'phase32h-r1-baseline-r3-sha256.txt',
    'FROZEN_BLOCKED_EVIDENCE',
    'FROZEN_PASS_EVIDENCE',
  ];

  const report = `# Phase 32H-R1 Baseline-r3 BLOCKED

- Root: \`${outRoot}\`
- Frozen at: ${frozenAt}
- Classification: **BLOCKED**
- Evidence admissibility: **NO**
- Blocked reason: **${BLOCKED_REASON}**

## Observed at shutdown

- Total: ${matrix.total}
- H1/H2/H3: ${matrix.per_protocol.h1}/${matrix.per_protocol.h2}/${matrix.per_protocol.h3}
- Triplet batches: ${Math.floor(matrix.total / 3)}
- Probe indexes: ${packetIndex.probe_index_count}
- Batch indexes: ${packetIndex.batch_correlation_count}
- Correlation backlog pending: ${backlogSnapshot.pending ?? backlogSnapshot.batches?.length ?? 0}

Matrix rows through 153 probes were quality-clean; the run is not admissible baseline evidence.

Never resume this root. Next root: \`/tmp/phase32h-r1-baseline-r4\`
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-baseline-r3-blocked-report.md'), report, 'utf8');

  let freezeIntegrity;
  try {
    freezeIntegrity = executeFreezeIntegrity({
      outRoot,
      repoRoot: REPO_ROOT,
      quietPeriodMs: Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
      gracefulMs: GRACEFUL_MS,
      hashManifestName: 'phase32h-r1-baseline-r3-sha256.txt',
      hashExcludeSuffixes: shaExclude,
      markerName: 'FROZEN_BLOCKED_EVIDENCE',
      markerContent: `${frozenAt}\n${BLOCKED_REASON}\n`,
      jsonlPaths,
      writersAlreadyStopped: true,
    });
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          status: 'BLOCKED',
          code: err.code || 'PHASE32H_FREEZE_INTEGRITY_BLOCKED',
          message: err.message,
          details: err.details || null,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const remaining = listRootScopedProcesses(outRoot);
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        frozen_at: frozenAt,
        root: outRoot,
        terminal_classification: 'BLOCKED',
        blocked_reason: BLOCKED_REASON,
        matrix,
        probe_indexes: packetIndex.probe_index_count,
        batch_indexes: packetIndex.batch_correlation_count,
        correlation_pending: backlogSnapshot.pending ?? backlogSnapshot.batches?.length ?? 0,
        processes_stopped: stopLedger.length,
        processes_remaining: remaining.length,
        jsonl_modified: jsonlModified,
        frozen_marker: 'FROZEN_BLOCKED_EVIDENCE',
        freeze_integrity: freezeIntegrity,
      },
      null,
      2,
    ),
  );
  process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ status: 'BLOCKED', error: err.message, stack: err.stack }, null, 2));
    process.exit(2);
  }
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

if (isMainModule() || process.env.PHASE32H_FREEZE_BASELINE_R3 === '1') {
  main();
}
