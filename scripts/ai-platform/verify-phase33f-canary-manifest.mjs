#!/usr/bin/env node
/**
 * Verify Phase 33F canary + smoke manifests (offline).
 */
import {
  buildCanaryManifest,
  buildSmokeManifest,
  validateManifestRowsForMode,
  hashManifest,
} from '../lib/phase33f-canary-manifest.mjs';
import { CANARY, SMOKE, CAPABILITIES } from '../lib/phase33f-canary-config.mjs';

const canaryRows = buildCanaryManifest();
const canary = validateManifestRowsForMode(canaryRows, { mode: 'canary' });
const smokeRows = buildSmokeManifest();
const smoke = validateManifestRowsForMode(smokeRows, { mode: 'smoke' });

const violations = [];
if (canary.status !== 'PASS') violations.push(...(canary.violations || []).slice(0, 20));
if (smoke.status !== 'PASS') violations.push(...(smoke.violations || []).slice(0, 20));
if (canaryRows.length !== CANARY.probes) violations.push(`canary_probe_count:${canaryRows.length}`);
if (smokeRows.length !== SMOKE.probes) violations.push(`smoke_probe_count:${smokeRows.length}`);
if (!CAPABILITIES.includes('negotiation_assistance')) {
  violations.push('missing_negotiation_assistance_capability');
}
if (CAPABILITIES.includes('negotiation')) {
  violations.push('legacy_negotiation_capability_name');
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  canary: {
    status: canary.status,
    probes: canaryRows.length,
    batches: canaryRows.length / 3,
    manifest_sha: hashManifest(canaryRows),
  },
  smoke: {
    status: smoke.status,
    probes: smokeRows.length,
    batches: smokeRows.length / 3,
    manifest_sha: hashManifest(smokeRows),
  },
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
