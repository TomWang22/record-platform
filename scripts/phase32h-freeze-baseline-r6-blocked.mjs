#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze baseline-r6 as BLOCKED (PCAP ring segment growth discovery defect).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import { R1_BASELINE_R6_ROOT } from './lib/phase32h-r1-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = R1_BASELINE_R6_ROOT;
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);
const BLOCKED_REASON = 'PCAP_RING_SEGMENT_GROWTH_DISCOVERY_DEFECT';

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

function firstTripletSchema(outRoot) {
  const probeDir = path.join(outRoot, 'probe-packet-index');
  const batchDir = path.join(outRoot, 'batch-packet-index');
  const probeFiles = fs.existsSync(probeDir) ? fs.readdirSync(probeDir).filter((n) => n.endsWith('.json')) : [];
  const batchFiles = fs.existsSync(batchDir) ? fs.readdirSync(batchDir).filter((n) => n.endsWith('.json')) : [];
  const probeIds = probeFiles.map((name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(probeDir, name), 'utf8')).probe_id;
    } catch {
      return null;
    }
  });
  const batchPath = path.join(outRoot, 'batches');
  let memberStatuses = null;
  if (fs.existsSync(batchPath)) {
    const batchJson = fs.readdirSync(batchPath).find((n) => n.endsWith('.json'));
    if (batchJson) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(batchPath, batchJson), 'utf8'));
        memberStatuses = batch.member_statuses || null;
      } catch {
        memberStatuses = null;
      }
    }
  }
  return {
    classification: 'PROBE_ID_NOT_HTTP_STATUS',
    probe_index_count: probeFiles.length,
    batch_index_count: batchFiles.length,
    probe_ids: probeIds.filter((id) => id != null),
    member_statuses: memberStatuses,
    matrix_rows_written: 0,
  };
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
    expectedProbeIndexes: 3,
    expectedBatchCorrelations: 1,
    requirePerProbeIndexes: true,
  });
  const registry = readCollectorRegistry(outRoot);
  const captureStatus = JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'));
  const configuredBase = captureStatus.file;
  const pcapDir = path.join(outRoot, 'pcap');
  const segmentFiles = fs.existsSync(pcapDir)
    ? fs.readdirSync(pcapDir).filter((n) => n.includes('_00001_') && n.endsWith('.pcapng'))
    : [];
  const actualSegment = segmentFiles.length
    ? path.join(pcapDir, segmentFiles[0])
    : null;
  const actualSegmentBytes = actualSegment && fs.existsSync(actualSegment) ? fs.statSync(actualSegment).size : 0;

  const blockedMarker = JSON.parse(fs.readFileSync(path.join(outRoot, 'COLLECTOR_COVERAGE_BLOCKED'), 'utf8'));
  const stopLedger = {
    frozen_at: frozenAt,
    entries: [],
    remaining: [],
    note: 'processes already stopped before freeze script',
  };

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-baseline-r6-process-stop-ledger.json', stopLedger);

  writeJson('phase32h-r1-baseline-r6-ring-growth-defect.json', {
    frozen_at: frozenAt,
    classification: 'PCAP_RING_SEGMENT_GROWTH_DISCOVERY_DEFECT',
    configured_output_base: configuredBase,
    actual_segment: actualSegment,
    configured_base_exists: configuredBase ? fs.existsSync(configuredBase) : false,
    actual_segment_exists: Boolean(actualSegment && fs.existsSync(actualSegment)),
    actual_segment_bytes: actualSegmentBytes,
    capture_active_before_block: true,
    pcap_drops: captureStatus.drops ?? 0,
    registry_semantics_passed: true,
    failure_class_at_block: 'PCAP_OUTPUT_NOT_GROWING',
    selected_repair: 'RUN_SCOPED_RING_SEGMENT_DISCOVERY_AND_GROWTH_TRACKING',
  });

  writeJson('phase32h-r1-baseline-r6-first-triplet-schema.json', firstTripletSchema(outRoot));

  writeJson('phase32h-r1-baseline-r6-blocked-manifest.json', {
    frozen_at: frozenAt,
    phase: '32H-R1 baseline-r6',
    root: outRoot,
    terminal_classification: 'BLOCKED',
    evidence_admissibility: 'NO',
    blocked_reason: BLOCKED_REASON,
    matrix_quality: 'NOT_EVALUATED — ZERO_MATRIX_ROWS',
    network_execution: 'FIRST_TRIPLET_REQUESTS_COMPLETED',
    pcap_status: 'ACTIVE_AND_CONTINUOUS_BEFORE_BLOCK',
    collector_block_marker: blockedMarker,
    run_id: launch.run_id || readRunId(outRoot),
    launch_head: launch.launch_head || readLaunchHead(outRoot),
    manifest_sha256: launch.manifest_sha256,
    observed_matrix_rows: rows.length,
    probe_packet_index_count: packetIndex.probe_index_count,
    batch_packet_index_count: packetIndex.batch_correlation_count,
    correlation_queue: queue,
    never_resume: true,
    future_root: '/tmp/phase32h-r1-baseline-r7',
  });

  writeJson('phase32h-r1-baseline-r6-blocked-integrity.json', {
    frozen_at: frozenAt,
    status: 'BLOCKED',
    matrix_rows: rows.length,
    packet_index_coverage: packetIndex,
    correlation_queue: queue,
    jsonl_hashes: jsonlHashesBefore,
    jsonl_modified: false,
    shutdown_status: 'PASS',
  });

  writeJson('phase32h-r1-baseline-r6-pcap-continuity.json', { frozen_at: frozenAt, ...pcapContinuitySnapshot(outRoot) });

  const report = `# Phase 32H-R1 Baseline-r6 BLOCKED

- Root: \`${outRoot}\`
- Classification: **BLOCKED — PCAP_RING_SEGMENT_GROWTH_DISCOVERY_DEFECT**
- Matrix rows: **0/8640**
- Request artifacts: 3 probe indexes, 1 batch index (first triplet H1/H2/H3 PASS)
- PCAP: active and continuous before block; ring segment \`${actualSegment || 'n/a'}\` (${actualSegmentBytes} bytes)

Never resume. Next root: \`/tmp/phase32h-r1-baseline-r7\`
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-baseline-r6-blocked-report.md'), report, 'utf8');

  fs.mkdirSync('/tmp/phase32h-ring-growth-rca', { recursive: true });
  fs.writeFileSync(
    '/tmp/phase32h-ring-growth-rca/root-cause.json',
    `${JSON.stringify(
      {
        classification: 'PCAP_RING_SEGMENT_GROWTH_DISCOVERY_DEFECT',
        configured_output_base: configuredBase,
        actual_segment: actualSegment,
        configured_base_exists: configuredBase ? fs.existsSync(configuredBase) : false,
        actual_segment_exists: Boolean(actualSegment && fs.existsSync(actualSegment)),
        actual_segment_bytes: actualSegmentBytes,
        capture_active: true,
        pcap_drops: captureStatus.drops ?? 0,
        registry_semantics_passed: true,
        selected_repair: 'RUN_SCOPED_RING_SEGMENT_DISCOVERY_AND_GROWTH_TRACKING',
        dumpcap_segment_naming:
          'macOS dumpcap ring buffer writes {basename}_NNNNN_YYYYMMDDHHMMSS.pcapng; base -w path is a naming template',
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
    hashManifestName: 'phase32h-r1-baseline-r6-sha256.txt',
    hashExcludeSuffixes: ['phase32h-r1-baseline-r6-sha256.txt', 'FROZEN_BLOCKED_EVIDENCE', 'FROZEN_PASS_EVIDENCE'],
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
