#!/usr/bin/env node
/**
 * Phase 32H — read-only runtime status (no evidence mutation, no collector control).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCollectorRegistry } from './lib/phase32h-collector-registry.mjs';
import { evaluatePcapCollectorIdentity } from './lib/phase32h-collector-registry.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { listProcessesWide } from './lib/phase32h-process-list.mjs';
import { buildProcessInspection, listCaptureCollectorCandidates } from './lib/phase32h-process-identity.mjs';
import { deriveRingOutputSpec, discoverRingSegments } from './lib/phase32h-pcap-ring-segments.mjs';
import { isCoverageBlocked } from './lib/phase32h-run-integrity.mjs';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { out: process.env.PHASE32H_MATRIX_ROOT || '/tmp/phase32h-r1-baseline' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function matrixCounts(outRoot) {
  const counts = { h1: 0, h2: 0, h3: 0, http_200: 0, http_422: 0 };
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    const rows = loadJsonl(file);
    counts[shard] = rows.length;
    counts.http_200 += rows.filter((r) => Number(r.http_status) === 200).length;
    counts.http_422 += rows.filter((r) => Number(r.http_status) === 422).length;
  }
  counts.total = counts.h1 + counts.h2 + counts.h3;
  return counts;
}

function diskSnapshot() {
  const df = spawnSync('df', ['-Pk', '/tmp'], { encoding: 'utf8' });
  const line = (df.stdout || '').trim().split('\n').pop();
  const parts = line?.split(/\s+/) || [];
  const availKib = Number(parts[3] || 0);
  return { avail_kib: availKib, avail_bytes: availKib * 1024, avail_gib: (availKib * 1024) / 1073741824 };
}

export function buildRuntimeStatus(outRoot) {
  const processes = listProcessesWide();
  const rootProcesses = processes.filter((p) => (p.command || '').includes(outRoot));
  const inspections = rootProcesses.map((p) => buildProcessInspection(p));
  const registry = readCollectorRegistry(outRoot);
  const identity = evaluatePcapCollectorIdentity(outRoot, processes, registry, { probesActive: true });
  const queue = readCorrelationQueueSnapshot(outRoot);
  const matrix = matrixCounts(outRoot);
  const packetIndex = evaluatePacketIndexCoverage(outRoot, {
    expectedProbeIndexes: matrix.total || null,
    expectedBatchCorrelations: matrix.total ? Math.floor(matrix.total / 3) : null,
    requirePerProbeIndexes: false,
  });
  const captureStatus = fs.existsSync(path.join(outRoot, 'pcap/capture-status.json'))
    ? JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'))
    : null;
  const ringSpec = captureStatus
    ? deriveRingOutputSpec(captureStatus.file, captureStatus, outRoot)
    : null;
  const ringDiscovery = ringSpec ? discoverRingSegments(outRoot, ringSpec) : null;
  const candidates = listCaptureCollectorCandidates(processes);
  const blockedMarkers = ['PHASE32H_FOREIGN_COLLECTOR_BLOCKED', 'PHASE32H_DUPLICATE_COLLECTOR_BLOCKED', 'COLLECTOR_COVERAGE_BLOCKED']
    .filter((name) => fs.existsSync(path.join(outRoot, name)))
    .map((name) => ({ name, path: path.join(outRoot, name) }));

  return {
    at: new Date().toISOString(),
    out: outRoot,
    blocked: isCoverageBlocked(outRoot),
    blocked_markers: blockedMarkers,
    matrix,
    queue,
    packet_index: packetIndex,
    registry,
    collector_identity: identity,
    capture_status: captureStatus,
    ring: ringDiscovery,
    registered_processes: inspections,
    capture_candidates: candidates.map((c) => ({
      pid: c.pid,
      comm: c.comm,
      executable_basename: c.executable_basename,
      evidence_root: c.evidence_root,
      output_path: c.output_path,
    })),
    diagnostic_processes: inspections.filter((i) => i.classification === 'NON_COLLECTOR'),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const status = buildRuntimeStatus(opts.out);
  status.disk = diskSnapshot();
  console.log(JSON.stringify(status, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
