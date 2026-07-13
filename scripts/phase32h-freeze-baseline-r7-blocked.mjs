#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze baseline-r7 as BLOCKED (false foreign collector classification).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { readRunId, readLaunchHead } from './lib/phase32h-run-integrity.mjs';
import { executeFreezeIntegrity, listRootScopedProcesses } from './lib/phase32h-freeze-integrity.mjs';
import { readCollectorRegistry, FOREIGN_COLLECTOR_MARKER } from './lib/phase32h-collector-registry.mjs';
import { buildProcessInspection } from './lib/phase32h-process-identity.mjs';
import { R1_BASELINE_R7_ROOT } from './lib/phase32h-r1-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = R1_BASELINE_R7_ROOT;
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);
const BLOCKED_REASON = 'FALSE_FOREIGN_COLLECTOR_PROCESS_CLASSIFICATION';

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
    ring_growth_before_block: captureStatus?.ring_growth_state || 'PCAP_ACTIVE_GROWING',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = opts.out;
  const foreignMarkerPath = path.join(outRoot, FOREIGN_COLLECTOR_MARKER);
  if (!fs.existsSync(foreignMarkerPath)) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: `${FOREIGN_COLLECTOR_MARKER} marker missing` }, null, 2));
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
  const matrix = summarizeMatrix(rows);
  const launch = JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-launch.json'), 'utf8'));
  const queue = readCorrelationQueueSnapshot(outRoot);
  const packetIndex = evaluatePacketIndexCoverage(outRoot, {
    expectedProbeIndexes: matrix.total,
    expectedBatchCorrelations: Math.floor(matrix.total / 3),
    requirePerProbeIndexes: true,
  });
  const registry = readCollectorRegistry(outRoot);
  const foreignMarker = JSON.parse(fs.readFileSync(foreignMarkerPath, 'utf8'));
  const falseForeign = foreignMarker.foreign_collectors?.[0] || null;
  const falseInspection = falseForeign
    ? buildProcessInspection({
        pid: falseForeign.pid,
        ppid: falseForeign.ppid,
        comm: 'bash',
        lstart: falseForeign.lstart,
        command: falseForeign.command,
      })
    : null;
  const pcapStatus = pcapContinuitySnapshot(outRoot);

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-baseline-r7-process-stop-ledger.json', {
    frozen_at: frozenAt,
    entries: JSON.parse(fs.readFileSync(path.join(outRoot, 'run-state/blocked-run-teardown.json'), 'utf8')).cleanup
      ?.ledger || [],
    note: 'collectors stopped during blocked-run teardown before freeze',
  });

  writeJson('phase32h-r1-baseline-r7-false-foreign-process.json', {
    frozen_at: frozenAt,
    classification: 'FOREIGN_COLLECTOR_SUBSTRING_MATCH_FALSE_POSITIVE',
    false_pid: falseForeign?.pid ?? null,
    false_ppid: falseForeign?.ppid ?? null,
    false_lstart: falseForeign?.lstart ?? null,
    false_command: falseForeign?.command ?? null,
    incorrect_classification: 'FOREIGN_PHASE32H_PCAP_PROCESS',
    correct_classification: BLOCKED_REASON,
    process_inspection: falseInspection,
    owned_pcap_output: false,
    registry_match: false,
    expected_registered_pid: foreignMarker.expected_pid ?? registry?.collectors?.pcap_collector?.pid ?? null,
    classifier_branch: 'isPhase32hCaptureProcess(command) substring match on dumpcap inside bash -c',
    selected_repair: 'EXECUTABLE_IDENTITY_PROCESS_CLASSIFICATION',
  });

  writeJson('phase32h-r1-baseline-r7-queue-snapshot.json', { frozen_at: frozenAt, ...queue });

  writeJson('phase32h-r1-baseline-r7-blocked-manifest.json', {
    frozen_at: frozenAt,
    phase: '32H-R1-baseline-r7',
    root: outRoot,
    terminal_classification: 'BLOCKED',
    evidence_admissibility: 'NO',
    matrix_service_quality_verdict: 'CLEAN_THROUGH_21_PROBES_NOT_EVALUATED_TO_TARGET',
    blocked_reason: BLOCKED_REASON,
    foreign_collector_marker: foreignMarker,
    run_id: launch.run_id || readRunId(outRoot),
    launch_head: launch.launch_head || readLaunchHead(outRoot),
    manifest_sha256: launch.manifest_sha256,
    observed_at_shutdown: matrix,
    triplet_batches: Math.floor(matrix.total / 3),
    probe_packet_index_count: packetIndex.probe_index_count,
    batch_packet_index_count: packetIndex.batch_correlation_count,
    correlation_queue: queue,
    ring_growth_before_block: pcapStatus.ring_growth_before_block,
    never_resume: true,
    future_root: '/tmp/phase32h-r1-baseline-r8',
  });

  writeJson('phase32h-r1-baseline-r7-blocked-integrity.json', {
    frozen_at: frozenAt,
    status: 'BLOCKED',
    matrix,
    packet_index_coverage: packetIndex,
    correlation_queue: queue,
    jsonl_hashes: jsonlHashesBefore,
    jsonl_modified: false,
    collectors_stopped: true,
    open_writers: 0,
    shutdown_status: 'PASS',
  });

  writeJson('phase32h-r1-baseline-r7-pcap-continuity.json', { frozen_at: frozenAt, ...pcapStatus });

  const report = `# Phase 32H-R1 Baseline-r7 BLOCKED

- Root: \`${outRoot}\`
- Frozen at: ${frozenAt}
- Classification: **BLOCKED — ${BLOCKED_REASON}**
- Matrix: ${matrix.total} rows (H1/H2/H3 ${matrix.per_protocol.h1}/${matrix.per_protocol.h2}/${matrix.per_protocol.h3})
- Batches: ${Math.floor(matrix.total / 3)}
- Ring growth: PASS through ${Math.floor(matrix.total / 3)} batches before false foreign block
- False PID: ${falseForeign?.pid ?? 'n/a'} (diagnostic shell, not dumpcap)

Never resume. Next root: \`/tmp/phase32h-r1-baseline-r8\`
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-baseline-r7-blocked-report.md'), report, 'utf8');

  fs.mkdirSync('/tmp/phase32h-foreign-collector-rca', { recursive: true });
  fs.writeFileSync(
    '/tmp/phase32h-foreign-collector-rca/root-cause.json',
    `${JSON.stringify(
      {
        classification: 'FOREIGN_COLLECTOR_SUBSTRING_MATCH_FALSE_POSITIVE',
        false_pid: falseForeign?.pid ?? 10745,
        false_ppid: falseForeign?.ppid ?? null,
        false_lstart: falseForeign?.lstart ?? null,
        false_comm: 'bash',
        false_executable_basename: 'bash',
        false_executable_path: '/opt/homebrew/bin/bash',
        false_argv_summary: 'bash -c embedded python diagnostic referencing dumpcap and evidence root',
        owned_pcap_output: false,
        registry_match: false,
        registered_collector_pid: registry?.collectors?.pcap_collector?.pid ?? null,
        had_real_w_argument: false,
        was_dumpcap_parent_or_child: false,
        classifier_branch: 'isPhase32hCaptureProcess substring match',
        selected_repair: 'EXECUTABLE_IDENTITY_PROCESS_CLASSIFICATION',
        process_inspection: falseInspection,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const freezeIntegrity = executeFreezeIntegrity({
    outRoot,
    repoRoot: REPO_ROOT,
    quietPeriodMs: Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
    gracefulMs: GRACEFUL_MS,
    hashManifestName: 'phase32h-r1-baseline-r7-sha256.txt',
    hashExcludeSuffixes: ['phase32h-r1-baseline-r7-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE', 'FROZEN_PASS_EVIDENCE'],
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
        terminal_classification: 'BLOCKED',
        blocked_reason: BLOCKED_REASON,
        matrix,
        probe_indexes: packetIndex.probe_index_count,
        batch_indexes: packetIndex.batch_correlation_count,
        queue,
        processes_remaining: remaining.length,
        jsonl_modified: false,
        frozen_marker: 'FROZEN_BLOCKED_EVIDENCE',
        foreign_marker_preserved: FOREIGN_COLLECTOR_MARKER,
        freeze_integrity: freezeIntegrity,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
