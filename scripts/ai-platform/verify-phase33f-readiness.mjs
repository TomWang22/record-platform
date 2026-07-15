#!/usr/bin/env node
/**
 * Phase 33F readiness. Exit codes:
 * 0 = evaluation completed and READY
 * 3 = evaluation completed and BLOCKED (expected until semantic quality improves)
 * 2 = evaluator/machinery failure
 */
import { evaluatePhase33fReadiness } from '../lib/phase33f-readiness.mjs';

try {
  const result = evaluatePhase33fReadiness({ createCanaryRootIfReady: false });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'READY') process.exit(0);
  if (result.status === 'BLOCKED') process.exit(3);
  process.exit(2);
} catch (err) {
  process.stderr.write(String(err?.stack || err) + '\n');
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', error: String(err?.message || err) }, null, 2)}\n`);
  process.exit(2);
}
