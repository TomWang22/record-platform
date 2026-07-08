#!/usr/bin/env node
/**
 * Phase 26D — read-only query observation instrumentation guard CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26dQueryObservationGuardError,
  validatePhase26dQueryObservation,
} from './lib/phase26d-query-observation-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26dQueryObservation(repoRoot);
  console.log('phase26d-query-observation-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26dQueryObservationGuardError ? err.message : String(err);
  console.error(`phase26d-query-observation-guard: FAIL — ${message}`);
  process.exit(1);
}
