#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase31LatencyOutlierGuardError,
  validatePhase31LatencyOutlierGuard,
} from './lib/phase31-latency-outlier-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = validatePhase31LatencyOutlierGuard(repoRoot);
  console.log('phase31-latency-outlier-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase31LatencyOutlierGuardError ? err.message : String(err);
  console.error(`phase31-latency-outlier-guard: FAIL — ${message}`);
  process.exit(1);
}
