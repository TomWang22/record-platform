/**
 * Phase 33F canary/smoke manifest helpers (wraps phase33f-manifest.mjs).
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
import { CANARY, SMOKE, dimensionsForMode } from './phase33f-canary-config.mjs';

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

export function buildManifestForMode(mode) {
  switch (mode) {
    case 'canary':
      return buildCanaryManifest({ batchesPerCapability: CANARY.batchesPerCapability });
    case 'smoke':
      return buildSmokeManifest();
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
