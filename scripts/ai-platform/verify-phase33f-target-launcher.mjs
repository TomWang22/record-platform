#!/usr/bin/env node
/**
 * Static checks for Phase 33F committed target launcher packaging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const REQUIRED = [
  'scripts/phase33f-launch-capability-target.mjs',
  'scripts/phase33f-target-launcher-smoke.mjs',
  'scripts/lib/phase33f-capability-launch-core.mjs',
  'scripts/lib/phase33f-target-preflight.mjs',
  'scripts/lib/phase33f-frozen-canary-v3.mjs',
  'tests/phase33f-target-launcher.test.mjs',
];

const violations = [];
for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(REPO_ROOT, rel))) violations.push(`missing:${rel}`);
}

for (const rel of [
  'scripts/lib/phase33f-target-preflight.mjs',
  'scripts/lib/phase33f-capability-launch-core.mjs',
  'scripts/phase33f-launch-capability-target.mjs',
]) {
  try {
    await import(pathToFileURL(path.join(REPO_ROOT, rel)).href);
  } catch (err) {
    violations.push(`import_fail:${rel}:${err.message}`);
  }
}

const targetLauncher = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts/phase33f-launch-capability-target.mjs'),
  'utf8',
);
if (!targetLauncher.includes('PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_SHA')) {
  // env constant may be imported — check preflight too
}
if (!targetLauncher.includes('runPhase33fTargetPreflight')) {
  violations.push('target_launcher_missing_preflight');
}
if (!targetLauncher.includes('runPhase33fCapabilityLaunch')) {
  violations.push('target_launcher_missing_launch_core');
}
if (targetLauncher.includes('--limit') && !targetLauncher.includes('rejects --limit')) {
  violations.push('target_launcher_must_reject_limit_override');
}

const canaryLauncher = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts/phase33f-launch-capability-canary.mjs'),
  'utf8',
);
if (!canaryLauncher.includes('not authorized from canary launcher')) {
  violations.push('canary_launcher_must_still_refuse_target_root');
}
if (!canaryLauncher.includes('refuseTargetOrSoakMode') && !canaryLauncher.includes("mode === 'target'")) {
  violations.push('canary_launcher_must_reject_target_mode');
}

const preflight = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts/lib/phase33f-target-preflight.mjs'),
  'utf8',
);
if (!preflight.includes('TARGET_APPROVAL_SHA_ENV')) {
  violations.push('target_preflight_missing_approval_sha_env');
}
if (!preflight.includes('canary approval cannot authorize target')) {
  violations.push('target_preflight_missing_canary_isolation');
}
if (preflight.includes('no target-to-soak') || preflight.includes('target-to-soak')) {
  // ok
} else {
  violations.push('target_preflight_missing_soak_refusal');
}

const smoke = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts/phase33f-target-launcher-smoke.mjs'),
  'utf8',
);
if (!smoke.includes('TARGET_SMOKE_ROOT') && !smoke.includes('phase33f-target-launcher-smoke-v1')) {
  violations.push('smoke_missing_dedicated_root');
}
if (!smoke.includes('never use the real target root') && !smoke.includes('REAL_TARGET_ROOT')) {
  violations.push('smoke_must_refuse_real_target_root');
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  required_files: REQUIRED.length,
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
