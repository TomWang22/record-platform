#!/usr/bin/env node
/**
 * Phase 26A — read-only schema guard CLI (no network, no DB apply).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26aSchemaGuardError,
  validatePhase26aSchema,
} from './lib/phase26a-ai-kpi-schema-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26aSchema(repoRoot);
  console.log('phase26a-schema-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26aSchemaGuardError ? err.message : String(err);
  console.error(`phase26a-schema-guard: FAIL — ${message}`);
  process.exit(1);
}
