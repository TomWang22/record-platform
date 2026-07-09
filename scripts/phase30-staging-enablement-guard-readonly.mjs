#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase30StagingEnablementGuardError,
  validatePhase30StagingEnablementGuard,
} from './lib/phase30-staging-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase30StagingEnablementGuard(repoRoot);
  console.log('phase30-staging-enablement-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase30StagingEnablementGuardError ? err.message : String(err);
  console.error(`phase30-staging-enablement-guard: FAIL — ${message}`);
  process.exit(1);
}
