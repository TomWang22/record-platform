#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Phase30ArchiveGuardError, validatePhase30Archive } from './lib/phase30-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase30Archive(repoRoot);
  console.log('phase30-archive-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase30ArchiveGuardError ? err.message : String(err);
  console.error(`phase30-archive-guard: FAIL — ${message}`);
  process.exit(1);
}
