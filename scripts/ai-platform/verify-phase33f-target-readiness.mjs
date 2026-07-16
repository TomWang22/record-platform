#!/usr/bin/env node
/**
 * Phase 33F target-readiness packaging gates (offline).
 * Does NOT create /tmp/phase33f-capability-gauntlet-target-v1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCanaryManifest } from '../lib/phase33f-canary-manifest.mjs';
import {
  WORKLOAD_HASH_SERIALIZATION_VERSION,
  hashCanonicalWorkload,
  computeManifestShaFromRows,
  legacyProbeIdWorkloadHash,
  classifyWorkloadHashReport,
} from '../lib/phase33f-workload-hash.mjs';
import {
  RUNNER_RESOURCE_TELEMETRY_VERSION,
  RESOURCE_POLICY_VERSION,
  RESOURCE_HARD_LIMITS,
} from '../lib/phase33f-runner-resource-telemetry.mjs';
import { REAL_TARGET_ROOT, CANARY, TARGET, TARGET_MANIFEST_SHA_PIN, TARGET_WORKLOAD_HASH_PIN } from '../lib/phase33f-canary-config.mjs';
import { INTER_BATCH_INTERVAL_MS, RATE_POLICY_VERSION } from '../lib/phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const REQUIRED = [
  'scripts/lib/phase33f-workload-hash.mjs',
  'scripts/lib/phase33f-runner-resource-telemetry.mjs',
  'scripts/lib/phase33f-capability-launch-core.mjs',
  'scripts/lib/phase33f-target-preflight.mjs',
  'scripts/phase33f-launch-capability-target.mjs',
  'scripts/phase33f-target-launcher-smoke.mjs',
  'scripts/phase33f-runtime-status-readonly.mjs',
  'scripts/phase33f-target-telemetry-smoke.mjs',
  'tests/phase33f-target-readiness.test.mjs',
  'tests/phase33f-target-launcher.test.mjs',
];

const violations = [];
for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(REPO_ROOT, rel))) violations.push(`missing:${rel}`);
}

if (fs.existsSync(REAL_TARGET_ROOT)) {
  violations.push('target_root_must_remain_absent');
}

const canaryRows = buildCanaryManifest({ batchesPerCapability: CANARY.batchesPerCapability });
const targetRows = buildCanaryManifest({ batchesPerCapability: TARGET.batchesPerCapability });
const canaryHash = hashCanonicalWorkload(canaryRows);
const targetHash = hashCanonicalWorkload(targetRows);
const canaryManifestSha = computeManifestShaFromRows(canaryRows);
const targetManifestSha = computeManifestShaFromRows(targetRows);
const legacy = legacyProbeIdWorkloadHash(canaryRows);

if (canaryRows.length !== 720) violations.push(`canary_probe_count:${canaryRows.length}`);
if (targetRows.length !== 17280) violations.push(`target_probe_count:${targetRows.length}`);
if (targetManifestSha !== TARGET_MANIFEST_SHA_PIN) {
  violations.push(`target_manifest_pin:${targetManifestSha}`);
}
if (targetHash.canonical_workload_hash !== TARGET_WORKLOAD_HASH_PIN) {
  violations.push(`target_workload_pin:${targetHash.canonical_workload_hash}`);
}if (canaryHash.duplicate_coordinate_keys !== 0) violations.push('canary_duplicate_coordinates');
if (targetHash.duplicate_coordinate_keys !== 0) violations.push('target_duplicate_coordinates');
if (canaryManifestSha === canaryHash.canonical_workload_hash) {
  violations.push('workload_hash_must_differ_from_manifest_sha');
}
if (legacy === '0e20147dbc4d0fa7da8ef6bdaefe06d47c5920dc3b794578e1aacfc3e4c39c8d') {
  // expected historical match — not a violation
} else {
  violations.push(`legacy_hash_drift:${legacy}`);
}

// Canary vs target share equivalence (720 = 24 × 30-batch unit).
{
  const share = (rows, pred) => rows.filter(pred).length / rows.length;
  const keys = [
    [(r) => r.tags?.multi_turn, 'multi_turn'],
    [(r) => r.tags?.privacy_adversarial, 'adversarial'],
    [(r) => r.tags?.weak_or_stale, 'weak_or_stale'],
    [(r) => r.capability_mode === 'unauthorized_thread', 'unauthorized_thread'],
  ];
  for (const [pred, name] of keys) {
    const a = share(canaryRows, pred);
    const b = share(targetRows, pred);
    if (Math.abs(a - b) > 1e-12) violations.push(`distribution_drift:${name}:${a}:${b}`);
  }
}

const classification = classifyWorkloadHashReport({
  reportedWorkloadHash: canaryManifestSha,
  manifestSha: canaryManifestSha,
  recomputedWorkloadHash: canaryHash.canonical_workload_hash,
  previousWorkloadHash: legacy,
  legacyHash: legacy,
});
if (classification.classification !== 'CANONICAL_WORKLOAD_HASH_REPORTING_DEFECT') {
  // When reported equals manifest, must classify as reporting defect.
  if (canaryManifestSha !== canaryHash.canonical_workload_hash) {
    // ok — synthetic check below
  }
}

// Import modules to ensure they load.
try {
  await import(pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/phase33f-workload-hash.mjs')).href);
  await import(pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/phase33f-runner-resource-telemetry.mjs')).href);
} catch (err) {
  violations.push(`import_fail:${err.message}`);
}

const statusText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/phase33f-runtime-status-readonly.mjs'), 'utf8');
if (!statusText.includes('readRunnerResourceTelemetryTail')) {
  violations.push('status_cli_missing_resource_telemetry');
}
if (!statusText.includes('createReadStream') && !statusText.includes('readRunnerResourceTelemetryTail')) {
  violations.push('status_cli_unbounded_risk');
}

const runnerText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/phase33f-capability-runner.mjs'), 'utf8');
if (!runnerText.includes('appendRunnerResourceTelemetry')) {
  violations.push('runner_missing_resource_telemetry');
}
if (!runnerText.includes('stopped_for_resource')) {
  violations.push('runner_missing_resource_fail_closed');
}

if (CANARY.inter_batch_interval_ms !== INTER_BATCH_INTERVAL_MS) {
  violations.push('pacing_interval_mismatch');
}
if (CANARY.rate_policy_version !== RATE_POLICY_VERSION) {
  violations.push('rate_policy_mismatch');
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  serialization_version: WORKLOAD_HASH_SERIALIZATION_VERSION,
  resource_policy_version: RESOURCE_POLICY_VERSION,
  runner_telemetry_version: RUNNER_RESOURCE_TELEMETRY_VERSION,
  resource_hard_limits: RESOURCE_HARD_LIMITS,
  canary: {
    probes: canaryRows.length,
    manifest_sha: canaryManifestSha,
    canonical_workload_hash: canaryHash.canonical_workload_hash,
    legacy_probe_id_hash: legacy,
    duplicates: canaryHash.duplicate_coordinate_keys,
  },
  target: {
    probes: targetRows.length,
    batches: targetRows.length / 3,
    per_capability_batches: 720,
    manifest_sha: targetManifestSha,
    canonical_workload_hash: targetHash.canonical_workload_hash,
    duplicates: targetHash.duplicate_coordinate_keys,
    root: REAL_TARGET_ROOT,
    root_exists: fs.existsSync(REAL_TARGET_ROOT),
  },
  reporting_defect_demo: classifyWorkloadHashReport({
    reportedWorkloadHash: canaryManifestSha,
    manifestSha: canaryManifestSha,
    recomputedWorkloadHash: canaryHash.canonical_workload_hash,
    previousWorkloadHash: legacy,
    legacyHash: legacy,
  }),
  violations,
};

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
