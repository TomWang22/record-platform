#!/usr/bin/env node
/**
 * Offline verify: Phase 33F target manifest dimensions + approved pins.
 * Does NOT create the real target root.
 */
import fs from 'node:fs';
import {
  TARGET,
  TARGET_MANIFEST_SHA_PIN,
  TARGET_WORKLOAD_HASH_PIN,
  REAL_TARGET_ROOT,
  CANARY,
} from '../lib/phase33f-canary-config.mjs';
import {
  buildTargetManifest,
  buildCanaryManifest,
  assertTargetManifestPins,
  validateManifestRowsForMode,
  hashManifest,
} from '../lib/phase33f-canary-manifest.mjs';
import { CAPABILITIES } from '../lib/phase33f-manifest.mjs';

const violations = [];

if (fs.existsSync(REAL_TARGET_ROOT)) {
  violations.push('target_root_must_remain_absent');
}

try {
  const pin = assertTargetManifestPins();
  if (pin.manifest_sha !== TARGET_MANIFEST_SHA_PIN) violations.push('manifest_pin_mismatch');
  if (pin.canonical_workload_hash !== TARGET_WORKLOAD_HASH_PIN) {
    violations.push('workload_hash_pin_mismatch');
  }
  const validation = validateManifestRowsForMode(pin.rows, { mode: 'target' });
  if (validation.status !== 'PASS') violations.push('target_manifest_validation_fail');
  for (const cap of CAPABILITIES) {
    const n = new Set(pin.rows.filter((r) => r.capability === cap).map((r) => r.batch_id)).size;
    if (n !== TARGET.batchesPerCapability) violations.push(`cap_batches:${cap}:${n}`);
  }
} catch (err) {
  violations.push(`pin_assert:${err.code || err.message}`);
}

const canary = buildCanaryManifest();
if (canary.length !== CANARY.probes) violations.push(`canary_drift:${canary.length}`);
if (hashManifest(canary) === TARGET_MANIFEST_SHA_PIN) {
  violations.push('canary_manifest_must_differ_from_target_pin');
}

// Ensure buildTargetManifest matches pin helper.
const rows = buildTargetManifest();
if (rows.length !== TARGET.probes) violations.push(`probe_count:${rows.length}`);

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  target: {
    probes: TARGET.probes,
    batches: TARGET.batches,
    per_capability_batches: TARGET.batchesPerCapability,
    manifest_sha_pin: TARGET_MANIFEST_SHA_PIN,
    workload_hash_pin: TARGET_WORKLOAD_HASH_PIN,
  },
  target_root_exists: fs.existsSync(REAL_TARGET_ROOT),
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
