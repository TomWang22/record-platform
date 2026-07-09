#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase29ArchiveGuardError,
  validatePhase29Archive,
} from './lib/phase29-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase29Archive(repoRoot);
  console.log('phase29-archive-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase29ArchiveGuardError ? err.message : String(err);
  console.error(`phase29-archive-guard: FAIL — ${message}`);
  process.exit(1);
}
