#!/usr/bin/env node
/**
 * Generate exact-SHA CI approval artifact for Phase 32H baseline launch.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import {
  assertSourceReconciliation,
  generateCiApprovalForHead,
  evaluateCiApprovalRecord,
  approvalPathForSha,
} from './lib/phase32h-ci-approval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function main() {
  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  const record = generateCiApprovalForHead({ headSha, originMainSha, repoRoot: REPO_ROOT });
  const report = evaluateCiApprovalRecord(record, { headSha, originMainSha });
  console.log(
    JSON.stringify(
      {
        status: report.status,
        approval_path: approvalPathForSha(headSha),
        sha: headSha,
        origin_main_sha: originMainSha,
        all_required_terminal_green: report.all_required_terminal_green,
        violations: report.violations,
      },
      null,
      2,
    ),
  );
  process.exit(report.status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
