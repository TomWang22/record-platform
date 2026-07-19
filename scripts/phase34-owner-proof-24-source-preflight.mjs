#!/usr/bin/env node
/**
 * Phase 34 — 24-scenario diagnostic source preflight launcher.
 * NOT owner-proof. Does not launch live recapture.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeOwnerProof24SourcePreflight } from './lib/phase34-owner-proof-24-source-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const summary = await executeOwnerProof24SourcePreflight({});
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'SOURCE_24_PREFLIGHT_PASS' &&
      summary.status !== 'SOURCE_24_PREFLIGHT_EXECUTED_WITH_GATE_FINDINGS') {
    process.exit(2);
  }
  // Gate findings still exit 0 for diagnostic tooling readiness; print status clearly.
  if (summary.status === 'SOURCE_24_PREFLIGHT_EXECUTED_WITH_GATE_FINDINGS') {
    console.error(
      'DIAGNOSTIC_NOTE: scenarios/protocol passed; some material-correction or quality gates still open',
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
