#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase29ProductionEnablementGuardError,
  validatePhase29ProductionEnablementGuard,
} from './lib/phase29-production-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase29ProductionEnablementGuard(repoRoot);
  console.log('phase29-production-enablement-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase29ProductionEnablementGuardError ? err.message : String(err);
  console.error(`phase29-production-enablement-guard: FAIL — ${message}`);
  process.exit(1);
}
