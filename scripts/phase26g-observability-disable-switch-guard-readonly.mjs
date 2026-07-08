#!/usr/bin/env node
/**
 * Phase 26G — observability disable-switch drill guard CLI (read-only).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26gObservabilityDisableSwitchGuardError,
  validatePhase26gObservabilityDisableSwitch,
} from './lib/phase26g-observability-disable-switch-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26gObservabilityDisableSwitch(repoRoot, { runPythonDrill: true });
  console.log('phase26g-observability-disable-switch-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26gObservabilityDisableSwitchGuardError ? err.message : String(err);
  console.error(`phase26g-observability-disable-switch-guard: FAIL — ${message}`);
  process.exit(1);
}
