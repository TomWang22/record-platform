#!/usr/bin/env node
/**
 * Phase 32H-F — closeout read-only guard (requires complete targeted matrix evidence).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePhase32hRoot, Phase32hGuardError } from './lib/phase32h-targeted-reproduction-guard.mjs';
import { resolvePhase32hRoot, TARGET_TOTAL } from './lib/phase32h-targeted-reproduction-config.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`phase32h-closeout-guard: ${message}`);
  process.exit(2);
}

function main() {
  const requireComplete = process.argv.includes('--require-complete');
  const outRoot = resolvePhase32hRoot(process.env);

  try {
    validatePhase32hRoot(outRoot);
  } catch (err) {
    if (requireComplete) fail(err.message);
    console.log(JSON.stringify({ status: 'IN_PROGRESS', reason: err.message }, null, 2));
    return;
  }

  const summaryPath = path.join(outRoot, 'phase32h-targeted-summary.json');
  if (!fs.existsSync(summaryPath)) {
    if (requireComplete) fail('missing phase32h-targeted-summary.json');
    console.log(JSON.stringify({ status: 'IN_PROGRESS' }, null, 2));
    return;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (summary.matrix_total !== `${TARGET_TOTAL}/${TARGET_TOTAL}`) {
    if (requireComplete) fail(`matrix incomplete: ${summary.matrix_total}`);
    console.log(JSON.stringify({ status: 'IN_PROGRESS', matrix_total: summary.matrix_total }, null, 2));
    return;
  }

  const closeoutDoc = path.join(REPO_ROOT, 'docs/ai-platform/PHASE_32H_TARGETED_REPRODUCTION_CLOSEOUT.md');
  if (!fs.existsSync(closeoutDoc)) {
    if (requireComplete) fail('missing PHASE_32H_TARGETED_REPRODUCTION_CLOSEOUT.md');
    console.log(JSON.stringify({ status: 'IN_PROGRESS', reason: 'closeout doc missing' }, null, 2));
    return;
  }

  const doc = fs.readFileSync(closeoutDoc, 'utf8');
  if (!doc.includes('Production enablement: NOT APPROVED')) {
    fail('closeout doc must state production enablement NOT APPROVED');
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        phase: '32H-F',
        matrix_total: summary.matrix_total,
        summary_status: summary.status,
        production_enablement: 'NOT APPROVED',
      },
      null,
      2,
    ),
  );
}

main();
