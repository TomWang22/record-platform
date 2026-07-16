#!/usr/bin/env node
/**
 * Static checks that Phase 33F canary launcher modules exist and import cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const REQUIRED = [
  'scripts/phase33f-launch-capability-canary.mjs',
  'scripts/phase33f-runtime-status-readonly.mjs',
  'scripts/lib/phase33f-canary-config.mjs',
  'scripts/lib/phase33f-canary-manifest.mjs',
  'scripts/lib/phase33f-canary-preflight.mjs',
  'scripts/lib/phase33f-auth-smoke.mjs',
  'scripts/lib/phase33f-quic-pcap-preflight.mjs',
  'scripts/lib/phase33f-capability-runner.mjs',
  'scripts/lib/phase33f-capability-probe.mjs',
  'scripts/lib/phase33f-capability-probe-worker.mjs',
  'scripts/lib/phase33f-terminal-verdict.mjs',
  'scripts/lib/phase33f-run-finalize.mjs',
  'scripts/lib/phase33f-rate-limit.mjs',
  'tests/phase33f-canary-launcher.test.mjs',
  'tests/phase33f-blocked-freeze.test.mjs',
  'tests/phase33f-rate-limit-observability.test.mjs',
];

const violations = [];
for (const rel of REQUIRED) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) violations.push(`missing:${rel}`);
}

const imports = [
  'scripts/lib/phase33f-canary-config.mjs',
  'scripts/lib/phase33f-canary-manifest.mjs',
  'scripts/lib/phase33f-canary-preflight.mjs',
  'scripts/lib/phase33f-capability-runner.mjs',
  'scripts/lib/phase33f-terminal-verdict.mjs',
];

for (const rel of imports) {
  try {
    await import(pathToFileURL(path.join(REPO_ROOT, rel)).href);
  } catch (err) {
    violations.push(`import_fail:${rel}:${err.message}`);
  }
}

const launcherText = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts/phase33f-launch-capability-canary.mjs'),
  'utf8',
);
if (!launcherText.includes('runPhase33fCanaryPreflight')) {
  violations.push('launcher_missing_preflight_wire');
}
if (!launcherText.includes('PHASE33F_OWNER_LAUNCH_APPROVED_SHA')) {
  violations.push('launcher_missing_owner_approval_gate');
}
const usesLaunchCore = launcherText.includes('runPhase33fCapabilityLaunch');
const usesInlineFinalize =
  launcherText.includes('finalizePhase33fRun') || launcherText.includes('finalizeSmokeWithFreeze');
if (!usesLaunchCore && !usesInlineFinalize) {
  violations.push('launcher_missing_freeze_wire');
}
if (!usesLaunchCore && !launcherText.includes('finalizePhase33fRun')) {
  violations.push('launcher_missing_phase33f_finalize_helper');
}
if (usesLaunchCore) {
  const corePath = path.join(REPO_ROOT, 'scripts/lib/phase33f-capability-launch-core.mjs');
  if (!fs.existsSync(corePath)) {
    violations.push('launcher_missing_launch_core_module');
  } else {
    const coreText = fs.readFileSync(corePath, 'utf8');
    if (!coreText.includes('finalizePhase33fRun')) {
      violations.push('launch_core_missing_phase33f_finalize_helper');
    }
    if (!coreText.includes('FROZEN_BLOCKED_EVIDENCE') && !fs.existsSync(path.join(REPO_ROOT, 'scripts/lib/phase33f-run-finalize.mjs'))) {
      violations.push('launcher_missing_blocked_freeze_path');
    }
  }
} else if (!launcherText.includes('FROZEN_BLOCKED_EVIDENCE') && !fs.existsSync(path.join(REPO_ROOT, 'scripts/lib/phase33f-run-finalize.mjs'))) {
  violations.push('launcher_missing_blocked_freeze_path');
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  required_files: REQUIRED.length,
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
