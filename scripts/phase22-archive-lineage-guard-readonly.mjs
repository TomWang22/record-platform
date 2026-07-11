#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateActiveContextFile } from './lib/phase22-archive-lineage-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validateActiveContextFile(repoRoot);
  console.log('phase22-archive-lineage-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`phase22-archive-lineage-guard: FAIL — ${err.message}`);
  process.exit(1);
}
