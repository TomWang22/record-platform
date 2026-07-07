#!/usr/bin/env node
/**
 * Phase 25E — read-only design guard CLI (no network, no DB, no cluster access).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase25DesignGuardError,
  validatePhase25Design,
} from './lib/phase25-observability-design-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase25Design(repoRoot);
  console.log('phase25-design-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase25DesignGuardError ? err.message : String(err);
  console.error(`phase25-design-guard: FAIL — ${message}`);
  process.exit(1);
}
