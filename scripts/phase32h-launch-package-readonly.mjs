#!/usr/bin/env node
/**
 * Phase 32H-R1 — emit baseline launch package JSON without node -e ESM eval.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildBaselineLaunchPackage } from './phase32h-baseline-preflight-readonly.mjs';
import { approvalPathForSha } from './lib/phase32h-ci-approval.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { approvalPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--approval') opts.approvalPath = argv[++i];
    if (argv[i] === '--head-sha') {
      const sha = argv[++i];
      opts.approvalPath = approvalPathForSha(sha);
    }
  }
  return opts;
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function buildLaunchPackageReport({ approvalPath = null } = {}) {
  const pkg = buildBaselineLaunchPackage();
  const headSha = gitSha();
  const report = {
    ...pkg,
    head_sha: headSha,
    origin_main_sha: headSha,
    launch_package_cli: 'scripts/phase32h-launch-package-readonly.mjs',
  };
  if (approvalPath) {
    if (!fs.existsSync(approvalPath)) {
      const err = new Error(`approval artifact missing: ${approvalPath}`);
      err.code = 'PHASE32H_LAUNCH_PACKAGE_BLOCKED';
      throw err;
    }
    report.ci_approval_path = approvalPath;
    report.ci_approval_sha256 = sha256File(approvalPath);
  }
  return report;
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = buildLaunchPackageReport({ approvalPath: opts.approvalPath });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(err.code === 'PHASE32H_LAUNCH_PACKAGE_BLOCKED' ? 2 : 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
