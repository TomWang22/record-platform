#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { validatePhase32hRoot } from './lib/phase32h-targeted-reproduction-guard.mjs';
import { resolvePhase32hRoot, TARGET_TOTAL } from './lib/phase32h-targeted-reproduction-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const outRoot = resolvePhase32hRoot(process.env);
  const result = validatePhase32hRoot(outRoot);
  const summaryPath = path.join(outRoot, 'phase32h-targeted-summary.json');
  if (process.argv.includes('--require-complete')) {
    if (!fs.existsSync(summaryPath)) {
      throw new Error('missing phase32h-targeted-summary.json');
    }
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    if (summary.matrix_total !== `${TARGET_TOTAL}/${TARGET_TOTAL}`) {
      throw new Error(`matrix incomplete: ${summary.matrix_total}`);
    }
    if (summary.gates?.status !== 'PASS' && summary.status !== 'PASS_WITH_EXTREMES') {
      throw new Error(`quality gates not PASS: ${summary.gates?.status ?? summary.status}`);
    }
  }
  console.log('phase32h-targeted-reproduction-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`phase32h-targeted-reproduction-guard: ${err.message}`);
  if (process.argv.includes('--require-complete')) process.exit(2);
}
