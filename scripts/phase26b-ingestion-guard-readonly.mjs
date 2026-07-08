#!/usr/bin/env node
/**
 * Phase 26B — read-only ingestion instrumentation guard CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26bIngestionGuardError,
  validatePhase26bIngestion,
} from './lib/phase26b-ingestion-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26bIngestion(repoRoot);
  console.log('phase26b-ingestion-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26bIngestionGuardError ? err.message : String(err);
  console.error(`phase26b-ingestion-guard: FAIL — ${message}`);
  process.exit(1);
}
