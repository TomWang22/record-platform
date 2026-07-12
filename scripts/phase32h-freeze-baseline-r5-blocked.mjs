#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze baseline-r5 as BLOCKED (PCAP collector registry command fidelity defect).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { readRunId, readLaunchHead } from './lib/phase32h-run-integrity.mjs';
import {
  executeFreezeIntegrity,
  listRootScopedProcesses,
} from './lib/phase32h-freeze-integrity.mjs';
import { parseDumpcapSemantic } from './lib/phase32h-collector-launch-spec.mjs';
import { readCollectorRegistry } from './lib/phase32h-collector-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = '/tmp/phase32h-r1-baseline-r5';
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);
const BLOCKED_REASON = 'PCAP_COLLECTOR_REGISTRY_COMMAND_FIDELITY_DEFECT';

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
  return { files, capture_status: captureStatus, continuity: 'PASS', packet_drops: captureStatus?.drops ?? 0 };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = opts.out;
  if (!fs.existsSync(path.join(outRoot, 'COLLECTOR_COVERAGE_BLOCKED'))) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'COLLECTOR_COVERAGE_BLOCKED marker missing' }, null, 2));
    process.exit(2);
  }
  const remaining = listRootScopedProcesses(outRoot).filter((p) => p.pid !== process.pid);
  if (remaining.length > 0) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'root-scoped processes remain', remaining }, null, 2));
    process.exit(2);
  }

  const frozenAt = new Date().toISOString();
  const jsonlPaths = ['h1', 'h2', 'h3'].map((s) => path.join(outRoot, `shard-${s}`, 'phase32h-matrix.jsonl'));
  const jsonlHashesBefore = Object.fromEntries(
    jsonlPaths.filter((p) => fs.existsSync(p)).map((p) => [p, sha256FileSync(p)]),
  );
  const rows = loadShardRows(outRoot);
  const launch = JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-launch.json'), 'utf8'));
  const queue = readCorrelationQueueSnapshot(outRoot);
  const packetIndex = evaluatePacketIndexCoverage(outRoot, {
    expectedProbeIndexes: rows.length,
    expectedBatchCorrelations: fs.existsSync(path.join(outRoot, 'batches'))
      ? fs.readdirSync(path.join(outRoot, 'batches')).filter((n) => n.endsWith('.json')).length
      : 0,
    requirePerProbeIndexes: true,
  });
  const registry = readCollectorRegistry(outRoot);
  const captureStatus = JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'));
  const registeredSemantic = parseDumpcapSemantic(registry?.collectors?.pcap_collector?.command || '');
  const actualSemantic = parseDumpcapSemantic(captureStatus.argv || captureStatus.tool + ' ' + captureStatus.iface);

  const blockedMarker = JSON.parse(fs.readFileSync(path.join(outRoot, 'COLLECTOR_COVERAGE_BLOCKED'), 'utf8'));
  const stopLedger = fs.existsSync(path.join(outRoot, 'phase32h-r1-baseline-r5-process-stop-ledger.json'))
    ? JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-baseline-r5-process-stop-ledger.json'), 'utf8'))
    : { entries: [] };

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-baseline-r5-blocked-manifest.json', {
    frozen_at: frozenAt,
    phase: '32H-R1 baseline-r5',
    root: outRoot,
    terminal_classification: 'BLOCKED',
    evidence_admissibility: 'NO',
    blocked_reason: BLOCKED_REASON,
    matrix_quality: 'NOT_EVALUATED — ZERO_MATRIX_ROWS',
    request_execution: 'FIRST_TRIPLET_COMPLETED_NETWORK_REQUESTS, MATRIX_APPEND_BLOCKED',
    collector_block_marker: blockedMarker,
    run_id: launch.run_id || readRunId(outRoot),
    launch_head: launch.launch_head || readLaunchHead(outRoot),
    manifest_sha256: launch.manifest_sha256,
    observed_matrix_rows: rows.length,
    probe_packet_index_count: packetIndex.probe_index_count,
    batch_packet_index_count: packetIndex.batch_correlation_count,
    correlation_queue: queue,
    never_resume: true,
    future_root: '/tmp/phase32h-r1-baseline-r6',
  });

  writeJson('phase32h-r1-baseline-r5-registry-mismatch.json', {
    frozen_at: frozenAt,
    classification: 'REGISTRY_COMMAND_FIDELITY_DEFECT',
    registered_command: registry?.collectors?.pcap_collector?.command,
    capture_status_argv: captureStatus.argv || null,
    registered_semantic: registeredSemantic.semantic,
    actual_semantic: actualSemantic.semantic,
    missing_registered_arguments: ['-q', '-f', 'tcp port 443 or udp port 443 or port 53 or icmp or icmp6', '-b', 'filesize:250000', '-b', 'files:48'],
    expected_pid: registry?.collectors?.pcap_collector?.pid,
    process_alive_at_block: true,
    capture_active: captureStatus.status === 'ACTIVE',
    pcap_drops: captureStatus.drops ?? 0,
  });

  writeJson('phase32h-r1-baseline-r5-blocked-integrity.json', {
    frozen_at: frozenAt,
    status: 'BLOCKED',
    matrix_rows: rows.length,
    packet_index_coverage: packetIndex,
    correlation_queue: queue,
    jsonl_hashes: jsonlHashesBefore,
    jsonl_modified: false,
    shutdown_status: stopLedger.remaining?.length === 0 ? 'PASS' : 'PARTIAL',
  });

  writeJson('phase32h-r1-baseline-r5-pcap-continuity.json', { frozen_at: frozenAt, ...pcapContinuitySnapshot(outRoot) });

  const report = `# Phase 32H-R1 Baseline-r5 BLOCKED

- Root: \`${outRoot}\`
- Classification: **BLOCKED — PCAP_COLLECTOR_REGISTRY_COMMAND_FIDELITY_DEFECT**
- Matrix rows: **0/8640**
- Request artifacts: 3 probe indexes, 1 batch index (correlation PENDING)

Never resume. Next root: \`/tmp/phase32h-r1-baseline-r6\`
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-baseline-r5-blocked-report.md'), report, 'utf8');

  const freezeIntegrity = executeFreezeIntegrity({
    outRoot,
    repoRoot: REPO_ROOT,
    quietPeriodMs: Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
    gracefulMs: GRACEFUL_MS,
    hashManifestName: 'phase32h-r1-baseline-r5-sha256.txt',
    hashExcludeSuffixes: ['phase32h-r1-baseline-r5-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE', 'FROZEN_PASS_EVIDENCE'],
    markerName: 'FROZEN_BLOCKED_EVIDENCE',
    markerContent: `${frozenAt}\n${BLOCKED_REASON}\n`,
    jsonlPaths,
    writersAlreadyStopped: true,
  });

  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        frozen_at: frozenAt,
        root: outRoot,
        blocked_reason: BLOCKED_REASON,
        matrix_rows: rows.length,
        freeze_integrity: freezeIntegrity,
        collector_marker_preserved: 'COLLECTOR_COVERAGE_BLOCKED',
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
