/**
 * Phase 33F canary/smoke/target manifest helpers (wraps phase33f-manifest.mjs).
 */
import {
  buildCanaryManifest,
  validateManifestRows,
  hashManifest,
  writeManifest,
  loadManifest,
  CAPABILITIES,
  PROTOCOLS,
  CAPABILITY_MODES,
} from './phase33f-manifest.mjs';
import {
  CANARY,
  SMOKE,
  TARGET,
  TARGET_MANIFEST_SHA_PIN,
  TARGET_WORKLOAD_HASH_PIN,
  dimensionsForMode,
} from './phase33f-canary-config.mjs';
import { hashCanonicalWorkload, WORKLOAD_HASH_SERIALIZATION_VERSION } from './phase33f-workload-hash.mjs';

export {
  buildCanaryManifest,
  validateManifestRows,
  hashManifest,
  writeManifest,
  loadManifest,
  CAPABILITIES,
  PROTOCOLS,
  CAPABILITY_MODES,
};

export function buildSmokeManifest() {
  return buildCanaryManifest({ batchesPerCapability: SMOKE.batchesPerCapability });
}

export function buildTargetManifest() {
  return buildCanaryManifest({ batchesPerCapability: TARGET.batchesPerCapability });
}

export function buildManifestForMode(mode) {
  switch (mode) {
    case 'canary':
      return buildCanaryManifest({ batchesPerCapability: CANARY.batchesPerCapability });
    case 'smoke':
      return buildSmokeManifest();
    case 'target':
      return buildTargetManifest();
    default: {
      const _exhaustive = mode;
      throw new Error(`unknown phase33f mode: ${_exhaustive}`);
    }
  }
}

export function validateManifestRowsForMode(rows, { mode = 'canary' } = {}) {
  const dims = dimensionsForMode(mode);
  return validateManifestRows(rows, {
    expectedProbes: dims.probes,
    expectedBatches: dims.batches,
    batchesPerCapability: dims.batchesPerCapability,
  });
}

export function auditProductionMutationRows(rows) {
  const offenders = [];
  for (const row of rows) {
    if (row.production_mutation_allowed !== false) {
      offenders.push(row.probe_id);
    }
    if (row.expected_safety?.automatic_send_allowed !== false) {
      offenders.push(`automatic_send:${row.probe_id}`);
    }
  }
  return {
    status: offenders.length ? 'FAIL' : 'PASS',
    offenders,
    all_false: offenders.length === 0,
  };
}

/**
 * Independently regenerate target manifest and enforce approved pins.
 * Does not create REAL_TARGET_ROOT.
 */
export function assertTargetManifestPins(rows = null) {
  const targetRows = rows || buildTargetManifest();
  const manifestSha = hashManifest(targetRows);
  const workload = hashCanonicalWorkload(targetRows);
  const diffs = [];
  if (manifestSha !== TARGET_MANIFEST_SHA_PIN) {
    diffs.push({
      field: 'manifest_sha',
      expected: TARGET_MANIFEST_SHA_PIN,
      actual: manifestSha,
    });
  }
  if (workload.canonical_workload_hash !== TARGET_WORKLOAD_HASH_PIN) {
    diffs.push({
      field: 'canonical_workload_hash',
      expected: TARGET_WORKLOAD_HASH_PIN,
      actual: workload.canonical_workload_hash,
    });
  }
  if (workload.serialization_version !== WORKLOAD_HASH_SERIALIZATION_VERSION) {
    diffs.push({
      field: 'serialization_version',
      expected: WORKLOAD_HASH_SERIALIZATION_VERSION,
      actual: workload.serialization_version,
    });
  }
  if (targetRows.length !== TARGET.probes) {
    diffs.push({ field: 'probes', expected: TARGET.probes, actual: targetRows.length });
  }
  if (workload.duplicate_coordinate_keys !== 0) {
    diffs.push({
      field: 'duplicate_coordinate_keys',
      expected: 0,
      actual: workload.duplicate_coordinate_keys,
    });
  }
  if (diffs.length) {
    const err = new Error('PHASE33F_TARGET_MANIFEST_PIN_MISMATCH');
    err.code = 'PHASE33F_TARGET_MANIFEST_PIN_MISMATCH';
    err.details = { diffs, serialization_version: workload.serialization_version };
    throw err;
  }
  return {
    status: 'PASS',
    rows: targetRows,
    manifest_sha: manifestSha,
    canonical_workload_hash: workload.canonical_workload_hash,
    serialization_version: workload.serialization_version,
    duplicate_coordinate_keys: workload.duplicate_coordinate_keys,
    coordinate_count: workload.coordinate_count,
  };
}
