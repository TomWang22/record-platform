#!/usr/bin/env node
/**
 * Phase 23C — dry-run replay resume/checkpoint validation.
 * No live inference, no network, no cluster mutations.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertForbiddenSourceAbsent,
  runDryRunValidation,
} from './lib/phase23c-replay-resume-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase23c-'));

function main() {
  const sourceText = fs.readFileSync(scriptPath, 'utf8');
  assertForbiddenSourceAbsent(sourceText);

  const { results, failed } = runDryRunValidation({ fixtureRoot });

  for (const result of results) {
    console.log(`${result.status}: ${result.name}${result.error ? ` — ${result.error}` : ''}`);
  }

  if (failed.length) {
    console.error(`FAIL: ${failed.length} dry-run case(s) failed`);
    process.exit(1);
  }

  console.log('PASS: Phase 23C dry-run replay resume/checkpoint validation');
}

main();
