#!/usr/bin/env node
/**
 * Phase 26E — read-only usefulness observation instrumentation guard CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26eUsefulnessObservationGuardError,
  validatePhase26eUsefulnessObservation,
} from './lib/phase26e-usefulness-observation-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26eUsefulnessObservation(repoRoot);
  console.log('phase26e-usefulness-observation-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26eUsefulnessObservationGuardError ? err.message : String(err);
  console.error(`phase26e-usefulness-observation-guard: FAIL — ${message}`);
  process.exit(1);
}
