/**
 * Phase 32H-R1 — per-probe and batch packet-index coverage validation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listBatchPacketIndexes } from './phase32h-batch-packet-index.mjs';
import { probeIndexDir } from './phase32h-probe-packet-index.mjs';
import { assertRedactedInflightRecord } from './phase32h-inflight-probe-registry.mjs';
import {
  BATCH_INDEX_ALIGNMENT,
  evaluatePacketIndexLifecycle,
  isBlockedAlignment,
} from './phase32h-packet-index-lifecycle.mjs';

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

export { listBatchPacketIndexes };

export function evaluatePacketIndexCoverage(outRoot, {
  expectedProbeIndexes,
  expectedBatchCorrelations,
  requirePerProbeIndexes = true,
  completedBatchCount = null,
  matrixTotal = null,
  targetBatches = null,
  targetProbes = null,
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

  const integrityPass =
    perProbePass &&
    batchPass &&
    duplicateProbeIds === 0 &&
    duplicateBatchIds === 0 &&
    privateFieldViolations === 0;

  const lifecycle = evaluatePacketIndexLifecycle(outRoot, {
    expectedProbeIndexes,
    expectedBatchCorrelations,
    completedBatchCount:
      completedBatchCount != null
        ? completedBatchCount
        : batchPass && expectedBatchCorrelations != null
          ? expectedBatchCorrelations
          : null,
    matrixTotal,
    targetBatches: targetBatches ?? expectedBatchCorrelations,
    targetProbes: targetProbes ?? expectedProbeIndexes,
  });

  // Never emit literal BLOCKED for a valid active +1 lead.
  let status = lifecycle.status;
  if (status === BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD) {
    status = BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD;
  } else if (!integrityPass) {
    status = 'BLOCKED';
  } else if (status === BATCH_INDEX_ALIGNMENT.TERMINAL_PASS) {
    status = BATCH_INDEX_ALIGNMENT.TERMINAL_PASS;
  } else if (status === BATCH_INDEX_ALIGNMENT.ALIGNED) {
    status = BATCH_INDEX_ALIGNMENT.ALIGNED;
  } else if (isBlockedAlignment(status) || status === BATCH_INDEX_ALIGNMENT.SNAPSHOT_CHANGED_DURING_READ) {
    // keep lifecycle blocked / snapshot classifications
  } else {
    status = 'PASS';
  }

  return {
    status,
    lifecycle_status: lifecycle.status,
    classification: lifecycle.classification || lifecycle.status,
    delta: lifecycle.delta,
    active_batch_id: lifecycle.active_batch_id ?? null,
    phase: lifecycle.phase ?? null,
    pending_batch_indexes: lifecycle.pending_batch_indexes,
    complete_batch_indexes: lifecycle.complete_batch_indexes,
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
  const ok =
    report.status === 'PASS' ||
    report.status === BATCH_INDEX_ALIGNMENT.ALIGNED ||
    report.status === BATCH_INDEX_ALIGNMENT.TERMINAL_PASS;
  if (!ok || report.duplicate_probe_indexes > 0 || report.private_field_violations > 0) {
    const err = new Error(`packet index coverage BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_PACKET_INDEX_COVERAGE_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}
