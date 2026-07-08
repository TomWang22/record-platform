#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase27OperationalEnablementGuardError,
  validatePhase27OperationalEnablement,
} from './lib/phase27-operational-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDb = process.argv.includes('--skip-db');

try {
  const result = validatePhase27OperationalEnablement(repoRoot, { runIntrospection: !skipDb });
  console.log('phase27-operational-enablement-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase27OperationalEnablementGuardError ? err.message : String(err);
  console.error(`phase27-operational-enablement-guard: FAIL — ${message}`);
  process.exit(1);
}
