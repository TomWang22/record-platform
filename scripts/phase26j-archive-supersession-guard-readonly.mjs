#!/usr/bin/env node
/**
 * Phase 26J — archive supersession guard CLI (read-only).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26jArchiveSupersessionGuardError,
  validatePhase26jArchiveSupersession,
} from './lib/phase26j-archive-supersession-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26jArchiveSupersession(repoRoot);
  console.log('phase26j-archive-supersession-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26jArchiveSupersessionGuardError ? err.message : String(err);
  console.error(`phase26j-archive-supersession-guard: FAIL — ${message}`);
  process.exit(1);
}
