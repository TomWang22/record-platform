/**
 * Phase 32H-R1 — per-probe and batch packet-index coverage validation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { batchIndexDir } from './phase32h-batch-packet-index.mjs';
import { probeIndexDir, probeIndexPath } from './phase32h-probe-packet-index.mjs';
import { assertRedactedInflightRecord } from './phase32h-inflight-probe-registry.mjs';

const FORBIDDEN_PROBE_INDEX_FIELDS = [
  'question',
  'user_email',
  'user_uid',
  'authorization',
  'response_text',
  'body',
  'jwt',
  'token',
  'password',
];

export function assertRedactedProbePacketIndex(record) {
  const text = JSON.stringify(record).toLowerCase();
  for (const field of FORBIDDEN_PROBE_INDEX_FIELDS) {
    if (text.includes(`"${field}"`)) {
      throw new Error(`forbidden probe packet index field: ${field}`);
    }
  }
  if (/\beyj[a-z0-9]/i.test(text)) {
    throw new Error('jwt-like token in probe packet index');
  }
  assertRedactedInflightRecord({
    probe_id: record.probe_id,
    protocol: record.protocol_label,
    case_id: 'redacted',
    window: 1,
    run: 1,
    user_class: 'contract',
    expected_gate: 'allowlist',
    evidence_label: 'probe-index-redaction-check',
  });
}

export function listProbePacketIndexes(outRoot) {
  const dir = probeIndexDir(outRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, probe_id: Number(name.replace(/\.json$/, '')), record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    });
}

export function listBatchPacketIndexes(outRoot) {
  const dir = batchIndexDir(outRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, batch_id: name.replace(/\.json$/, ''), record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    });
}

export function evaluatePacketIndexCoverage(outRoot, {
  expectedProbeIndexes,
  expectedBatchCorrelations,
  requirePerProbeIndexes = true,
} = {}) {
  const probeIndexes = listProbePacketIndexes(outRoot);
  const batchIndexes = listBatchPacketIndexes(outRoot);
  const probeIds = probeIndexes.map((row) => row.record?.probe_id ?? row.probe_id);
  const duplicateProbeIds = probeIds.length - new Set(probeIds).size;
  const batchIds = batchIndexes.map((row) => row.batch_id);
  const duplicateBatchIds = batchIds.length - new Set(batchIds).size;

  let privateFieldViolations = 0;
  for (const row of probeIndexes) {
    try {
      assertRedactedProbePacketIndex(row.record);
    } catch {
      privateFieldViolations += 1;
    }
  }

  const perProbePass =
    !requirePerProbeIndexes ||
    (expectedProbeIndexes == null
      ? probeIndexes.length > 0
      : probeIndexes.length === expectedProbeIndexes);
  const batchPass =
    expectedBatchCorrelations == null
      ? batchIndexes.length > 0
      : batchIndexes.length === expectedBatchCorrelations;

  const status =
    perProbePass &&
    batchPass &&
    duplicateProbeIds === 0 &&
    duplicateBatchIds === 0 &&
    privateFieldViolations === 0
      ? 'PASS'
      : 'BLOCKED';

  return {
    status,
    per_probe_index_coverage: requirePerProbeIndexes
      ? `${probeIndexes.length}/${expectedProbeIndexes ?? '?'}`
      : 'NOT_REQUIRED',
    batch_correlation_coverage: `${batchIndexes.length}/${expectedBatchCorrelations ?? '?'}`,
    probe_index_count: probeIndexes.length,
    expected_probe_indexes: expectedProbeIndexes,
    batch_correlation_count: batchIndexes.length,
    expected_batch_correlations: expectedBatchCorrelations,
    duplicate_probe_indexes: duplicateProbeIds,
    duplicate_batch_indexes: duplicateBatchIds,
    private_field_violations: privateFieldViolations,
    historical_canary_without_per_probe:
      requirePerProbeIndexes === false && probeIndexes.length === 0 && batchIndexes.length > 0,
  };
}

export function assertPacketIndexCoverage(outRoot, options = {}) {
  const report = evaluatePacketIndexCoverage(outRoot, options);
  if (report.status !== 'PASS') {
    const err = new Error(`packet index coverage BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_PACKET_INDEX_COVERAGE_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}
