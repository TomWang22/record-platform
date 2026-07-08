#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase28ArchiveGuardError,
  validatePhase28Archive,
} from './lib/phase28-archive-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase28Archive(repoRoot);
  console.log('phase28-archive-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase28ArchiveGuardError ? err.message : String(err);
  console.error(`phase28-archive-guard: FAIL — ${message}`);
  process.exit(1);
}
