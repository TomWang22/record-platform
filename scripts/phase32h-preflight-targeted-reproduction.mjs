#!/usr/bin/env node
/**
 * Phase 32H-E0 — infrastructure preflight (CI-safe with --infra-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PHASE32H_OUT,
  PHASE32H_EVIDENCE_LABEL,
  TARGET_TOTAL,
  matrixDimensions,
} from './lib/phase32h-targeted-reproduction-config.mjs';
import { buildPhase32hManifest } from './phase32h-build-targeted-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const REQUIRED_SCRIPTS = [
  'scripts/lib/phase32h-targeted-reproduction-config.mjs',
  'scripts/lib/phase32h-inflight-probe-registry.mjs',
  'scripts/lib/phase32h-targeted-summary.mjs',
  'scripts/lib/phase32h-diagnostic-correlation.mjs',
  'scripts/lib/phase32h-targeted-reproduction-guard.mjs',
  'scripts/phase32h-build-targeted-manifest.mjs',
  'scripts/phase32h-targeted-reproduction-runner.mjs',
  'scripts/phase32h-launch-targeted-reproduction.mjs',
  'scripts/phase32h-monitor-targeted-reproduction.sh',
  'scripts/phase32h-extreme-watchdog.mjs',
  'scripts/phase32h-start-diagnostic-capture.sh',
  'scripts/phase32h-stop-diagnostic-capture.sh',
  'scripts/phase32h-start-pcap-capture.sh',
  'scripts/phase32h-stop-pcap-capture.sh',
  'scripts/phase32h-validate-pcap-smoke.sh',
  'scripts/phase32h-start-gateway-log-capture.sh',
  'scripts/phase32h-start-application-log-capture.sh',
  'scripts/lib/phase32h-pcap-chmodbpf.sh',
  'scripts/phase32h-capture-host-telemetry.sh',
  'scripts/phase32h-summarize-targeted-reproduction.mjs',
  'scripts/phase32h-correlate-diagnostic-evidence.mjs',
  'scripts/phase32h-targeted-reproduction-guard-readonly.mjs',
];

const REQUIRED_TESTS = [
  'tests/phase32h-targeted-manifest.test.mjs',
  'tests/phase32h-inflight-probe-registry.test.mjs',
  'tests/phase32h-extreme-watchdog.test.mjs',
  'tests/phase32h-targeted-summary.test.mjs',
  'tests/phase32h-diagnostic-correlation.test.mjs',
  'tests/phase32h-targeted-reproduction-guard.test.mjs',
];

function fail(message) {
  console.error(`phase32h preflight BLOCKED: ${message}`);
  process.exit(1);
}

function main() {
  const infraOnly = process.argv.includes('--infra-only');

  for (const rel of REQUIRED_SCRIPTS) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      fail(`missing script: ${rel}`);
    }
  }
  for (const rel of REQUIRED_TESTS) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      fail(`missing test: ${rel}`);
    }
  }

  const doc = path.join(REPO_ROOT, 'docs/ai-platform/PHASE_32H_LATENCY_ROOT_CAUSE_REMEDIATION.md');
  if (!fs.existsSync(doc)) fail('Phase 32H doc missing');
  const docText = fs.readFileSync(doc, 'utf8');
  if (!docText.includes('Production enablement: NOT APPROVED')) {
    fail('Phase 32H doc must state production enablement NOT APPROVED');
  }

  const dims = matrixDimensions();
  if (dims.total !== TARGET_TOTAL) {
    fail(`matrix dimensions total ${dims.total} != ${TARGET_TOTAL}`);
  }

  const manifest = buildPhase32hManifest();
  if (manifest.length !== TARGET_TOTAL) {
    fail(`manifest builder returned ${manifest.length} != ${TARGET_TOTAL}`);
  }
  if (!manifest.some((r) => r.case_id === 'final_tagged_plan')) {
    fail('manifest must include final_tagged_plan');
  }

  if (!infraOnly) {
    const tests = spawnSync('node', ['--test', ...REQUIRED_TESTS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (tests.status !== 0) {
      fail(`phase32h unit tests failed\n${tests.stderr || tests.stdout}`);
    }
  }

  if (!DEFAULT_PHASE32H_OUT.startsWith('/tmp/')) {
    fail('phase32h output must be under /tmp');
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        phase: '32H-E0',
        infra_only: infraOnly,
        evidence_label: PHASE32H_EVIDENCE_LABEL,
        target_total: TARGET_TOTAL,
        matrix_out: DEFAULT_PHASE32H_OUT,
        production_enablement: 'NOT APPROVED',
        generated_reports_committed: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
