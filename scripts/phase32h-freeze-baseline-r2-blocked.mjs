#!/usr/bin/env node
/**
 * Phase 32H-R1 — freeze baseline-r2 as BLOCKED (prelaunch policy violation).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  DISK_EVIDENCE_BUDGET_BYTES,
  DISK_EXECUTION_SAFETY_MARGIN_BYTES,
  DISK_OPERATIONAL_UNCERTAINTY_BYTES,
  DISK_PCAP_RING_BUDGET_BYTES,
  evaluateDiskPreflight,
} from './lib/phase32h-disk-preflight.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { sha256File, readRunId, readLaunchHead } from './lib/phase32h-run-integrity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = '/tmp/phase32h-r1-baseline-r2';
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);

const BLOCKED_REASON =
  'PRELAUNCH_POLICY_VIOLATION: exact-SHA CI was non-terminal at launch and projected disk reserve was below the required 10 GB safety margin.';

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

import {
  buildHistoricalFreezeMismatchReport,
  executeFreezeIntegrity,
  listRootScopedProcesses,
  stopWritersForRoot,
} from './lib/phase32h-freeze-integrity.mjs';

function walkFiles(root, { exclude = [] } = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, { exclude }));
    else if (!exclude.some((suffix) => full.endsWith(suffix))) files.push(full);
  }
  return files;
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

function main() {
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

  const stopLedger = stopWritersForRoot(outRoot, { gracefulMs: GRACEFUL_MS });
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
    cwd: REPO_ROOT,
  });

  const rows = loadShardRows(outRoot);
  const matrix = summarizeMatrix(rows);
  const launch = JSON.parse(fs.readFileSync(path.join(outRoot, 'phase32h-r1-launch.json'), 'utf8'));
  const launchDisk = evaluateDiskPreflight(outRoot);
  const projectedFootprint =
    DISK_EVIDENCE_BUDGET_BYTES + DISK_PCAP_RING_BUDGET_BYTES + DISK_EXECUTION_SAFETY_MARGIN_BYTES;
  const launchFreeBytes = launchDisk.free_bytes;
  const launchProjectedRemaining = launchFreeBytes - projectedFootprint;

  const ciAtLaunch = {
    launch_sha: launch.launch_head,
    note: 'Captured from operator report at launch time; CI was non-terminal for ci and docker-build',
    workflows_at_launch: [
      { name: 'ci', status: 'queued/in_progress', conclusion: null },
      { name: 'docker-build', status: 'queued/in_progress', conclusion: null },
      { name: 'RP Namespace Lint', status: 'completed', conclusion: 'success' },
    ],
    violation: 'PRELAUNCH_CI_GATE_VIOLATION',
  };

  const diskAtLaunch = {
    free_bytes_at_launch: launchFreeBytes,
    free_gb_at_launch: Number((launchFreeBytes / 1024 ** 3).toFixed(2)),
    projected_evidence_bytes: DISK_EVIDENCE_BUDGET_BYTES,
    projected_pcap_bytes: DISK_PCAP_RING_BUDGET_BYTES,
    safety_reserve_bytes: DISK_EXECUTION_SAFETY_MARGIN_BYTES,
    operational_uncertainty_bytes: DISK_OPERATIONAL_UNCERTAINTY_BYTES,
    projected_footprint_bytes: projectedFootprint,
    projected_remaining_bytes: launchProjectedRemaining,
    projected_remaining_gb: Number((launchProjectedRemaining / 1024 ** 3).toFixed(2)),
    required_hard_minimum_bytes:
      projectedFootprint + DISK_OPERATIONAL_UNCERTAINTY_BYTES,
    violation: 'PRELAUNCH_DISK_RESERVE_VIOLATION',
  };

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
    phase: '32H-R1-baseline-r2',
    root: outRoot,
    terminal_classification: 'PRELAUNCH_POLICY_VIOLATION',
    evidence_admissibility: 'NO',
    matrix_service_quality_verdict: 'NOT_EVALUATED_TO_TARGET',
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
    production_enablement: 'NOT APPROVED',
    never_resume: true,
    future_root: '/tmp/phase32h-r1-baseline-r3',
  };

  const blockedIntegrity = {
    frozen_at: frozenAt,
    status: 'BLOCKED',
    matrix,
    packet_index_coverage: packetIndex,
    ci_at_launch: ciAtLaunch,
    disk_at_launch: diskAtLaunch,
    jsonl_hashes: jsonlHashesAfter,
    jsonl_modified: jsonlModified,
    collector_continuity: 'PARTIAL',
    shutdown_status: stopLedger.every((e) => e.exit_at || e.exit_code === 0) ? 'PASS' : 'PARTIAL',
  };

  const writeJson = (name, payload) => {
    fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  writeJson('phase32h-r1-baseline-r2-blocked-manifest.json', blockedManifest);
  writeJson('phase32h-r1-baseline-r2-blocked-integrity.json', blockedIntegrity);
  writeJson('phase32h-r1-baseline-r2-process-stop-ledger.json', {
    frozen_at: frozenAt,
    graceful_timeout_ms: GRACEFUL_MS,
    entries: stopLedger,
  });
  writeJson('phase32h-r1-baseline-r2-disk-snapshot.json', {
    frozen_at: frozenAt,
    at_launch: diskAtLaunch,
    at_freeze: evaluateDiskPreflight(outRoot),
  });
  writeJson('phase32h-r1-baseline-r2-ci-at-launch.json', ciAtLaunch);

  const shaExclude = [
    'phase32h-r1-baseline-r2-sha256.txt',
    'FROZEN_BLOCKED_EVIDENCE',
    'FROZEN_PASS_EVIDENCE',
    'phase32h-r1-baseline-r2-freeze-integrity-addendum.json',
  ];

  const report = `# Phase 32H-R1 Baseline-r2 BLOCKED

- Root: \`${outRoot}\`
- Frozen at: ${frozenAt}
- Classification: **PRELAUNCH_POLICY_VIOLATION**
- Evidence admissibility: **NO**

## Violations

1. **PRELAUNCH_CI_GATE_VIOLATION** — \`22907bd\` CI was queued/in_progress at launch
2. **PRELAUNCH_DISK_RESERVE_VIOLATION** — projected remaining ~${diskAtLaunch.projected_remaining_gb} GB < 10 GB required

## Observed at shutdown

- Total: ${matrix.total}
- H1/H2/H3: ${matrix.per_protocol.h1}/${matrix.per_protocol.h2}/${matrix.per_protocol.h3}
- Probe indexes: ${packetIndex.probe_index_count}
- Batch indexes: ${packetIndex.batch_correlation_count}

Matrix rows may be technically clean; this does **not** make the run admissible baseline evidence.

Never resume this root. Future root: \`/tmp/phase32h-r1-baseline-r3\`
`;
  fs.writeFileSync(path.join(outRoot, 'phase32h-r1-baseline-r2-blocked-report.md'), report, 'utf8');

  let freezeIntegrity;
  try {
    freezeIntegrity = executeFreezeIntegrity({
      outRoot,
      repoRoot: REPO_ROOT,
      quietPeriodMs: Number(process.env.PHASE32H_FREEZE_QUIET_MS || 5000),
      gracefulMs: GRACEFUL_MS,
      hashManifestName: 'phase32h-r1-baseline-r2-sha256.txt',
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
        terminal_classification: 'PRELAUNCH_POLICY_VIOLATION',
        matrix,
        probe_indexes: packetIndex.probe_index_count,
        batch_indexes: packetIndex.batch_correlation_count,
        processes_stopped: stopLedger.length,
        sigkill_required: stopLedger.some((e) => e.sigkill_required),
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
