#!/usr/bin/env node
/**
 * Phase 32G-0 — preflight before timing-attributed repaired long soak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STALL_CAPTURE_FIELDS, TIMING_FIELDS } from './lib/phase32-timing-attribution.mjs';
import {
  DEFAULT_PHASE32G_MATRIX_OUT,
  PHASE32G_EVIDENCE_LABEL,
  TARGET_TOTAL,
} from './lib/phase32g-long-soak-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PHASE32F_DOC = path.join(
  REPO_ROOT,
  'docs/ai-platform/PHASE_32F_LATENCY_RCA_REMEDIATION_PLAN.md',
);

function fail(message) {
  console.error(`phase32g preflight BLOCKED: ${message}`);
  process.exit(1);
}

function main() {
  const infraOnly = process.argv.includes('--infra-only');

  if (!infraOnly) {
    const verify = spawnSync('make', ['ai-platform-verify-phase32f-latency-rca'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    if (verify.status !== 0) {
      fail(`make ai-platform-verify-phase32f-latency-rca failed\n${verify.stderr || verify.stdout}`);
    }
  }

  if (!fs.existsSync(PHASE32F_DOC)) {
    fail('Phase 32F doc missing');
  }
  const doc = fs.readFileSync(PHASE32F_DOC, 'utf8');
  if (!/Max outlier explained:\s*\*\*NO\*\*/i.test(doc) && !/Max outlier explained:\s*NO/i.test(doc)) {
    fail('Phase 32F doc must state Max outlier explained: NO');
  }

  const runnerPath = path.join(REPO_ROOT, 'scripts/phase31-controlled-observability-matrix-runner.mjs');
  const runnerSrc = fs.readFileSync(runnerPath, 'utf8');
  for (const field of [...TIMING_FIELDS, ...STALL_CAPTURE_FIELDS.slice(0, 5)]) {
    if (!runnerSrc.includes('buildTimingAttribution') && !runnerSrc.includes('finalizeProbeTiming')) {
      fail('matrix runner missing timing attribution hooks');
    }
  }
  if (!runnerSrc.includes('phase32g-long-soak-config')) {
    fail('matrix runner must import phase32g-long-soak-config for evidence label');
  }

  if (!DEFAULT_PHASE32G_MATRIX_OUT.startsWith('/tmp/')) {
    fail('phase32g output must be under /tmp');
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        phase: '32G-0',
        infra_only: infraOnly,
        evidence_label: PHASE32G_EVIDENCE_LABEL,
        target_total: TARGET_TOTAL,
        matrix_out: DEFAULT_PHASE32G_MATRIX_OUT,
        production_enablement: 'NOT APPROVED',
        generated_reports_committed: false,
        bench_logs_committed: false,
      },
      null,
      2,
    ),
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
