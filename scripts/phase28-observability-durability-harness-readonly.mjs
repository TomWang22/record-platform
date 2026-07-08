#!/usr/bin/env node
/**
 * Phase 28B — readonly CLI for offline durability harness self-check.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHarnessSelfCheck } from './lib/phase28-observability-durability-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const result = runHarnessSelfCheck(repoRoot);
console.log('Phase 28B observability durability harness: PASS');
console.log(JSON.stringify(result, null, 2));
