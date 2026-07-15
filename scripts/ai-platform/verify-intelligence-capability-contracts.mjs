#!/usr/bin/env node
/**
 * Phase 33A — offline intelligence capability contract verifier.
 * Machine-readable JSON on stdout; diagnostics on stderr.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIntelligenceCapabilityContracts } from '../lib/phase33a-intelligence-capability-contracts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const out = { packageRoot: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--package-root' && argv[i + 1]) {
      out.packageRoot = path.resolve(argv[++i]);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateIntelligenceCapabilityContracts(REPO_ROOT, {
    packageRoot: args.packageRoot || path.join(REPO_ROOT, 'scripts/ai-platform'),
  });
  if (report.status !== 'PASS') {
    console.error(
      `PHASE33A_CONTRACTS_FAIL violations=${report.violations.length} :: ${report.violations.slice(0, 12).join(' | ')}`,
    );
  } else {
    console.error('PHASE33A_CONTRACTS_PASS');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
