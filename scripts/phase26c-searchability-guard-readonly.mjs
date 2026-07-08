#!/usr/bin/env node
/**
 * Phase 26C — read-only searchability instrumentation guard CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26cSearchabilityGuardError,
  validatePhase26cSearchability,
} from './lib/phase26c-searchability-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26cSearchability(repoRoot);
  console.log('phase26c-searchability-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26cSearchabilityGuardError ? err.message : String(err);
  console.error(`phase26c-searchability-guard: FAIL — ${message}`);
  process.exit(1);
}
