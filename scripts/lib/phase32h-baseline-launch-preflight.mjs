/**
 * Phase 32H-R1 — ordered baseline launch preflight gates (before evidence root creation).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildR1CanaryManifest, buildR1Manifest } from '../phase32h-build-r1-manifest.mjs';
import { assertManifestContract } from './phase32h-manifest-contract.mjs';
import {
  assertCiApproval,
  assertCleanLauncherSource,
  assertSourceReconciliation,
} from './phase32h-ci-approval.mjs';
import { assertDiskPreflight } from './phase32h-disk-preflight.mjs';
import { evaluatePrelaunchGuard } from './phase32h-r1-prelaunch-guard.mjs';
import {
  evidenceLabelForArm,
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from './phase32h-r1-config.mjs';
import { assertLaunchableEvidenceRoot } from './phase32h-run-integrity.mjs';
import { assertCollectorExclusivityPreflight } from './phase32h-collector-exclusivity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export function validateManifestRowsInMemory({ arm, canary, evidenceLabel, launchHead, runId }) {
  const rows = canary
    ? buildR1CanaryManifest({ evidenceLabel })
    : buildR1Manifest({ evidenceLabel });
  assertManifestContract(rows, {
    evidenceLabel,
    launchHead,
    runId,
    expectedTotal: canary ? R1_CANARY_TOTAL : R1_TOTAL,
    expectedPerProtocol: canary ? R1_CANARY_PER_PROTOCOL : R1_PER_PROTOCOL,
  });
  return rows;
}

export function assertEvidenceRootAbsent(outRoot) {
  if (!fs.existsSync(outRoot)) return;
  const marker = path.join(outRoot, 'run-state', 'run-id');
  if (fs.readdirSync(outRoot).length > 0 && !fs.existsSync(marker)) {
    const err = new Error(`evidence root ${outRoot} is not empty; use a fresh root`);
    err.code = 'PHASE32H_LAUNCH_ROOT_BLOCKED';
    throw err;
  }
}

export function runStaticPreflightSmoke(repoRoot = REPO_ROOT) {
  const preflight = spawnSync('make', ['ai-platform-verify-phase32h-r1-prelaunch'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (preflight.status !== 0) {
    const err = new Error(preflight.stderr || preflight.stdout || 'static prelaunch failed');
    err.code = 'PHASE32H_LAUNCH_PREFLIGHT_BLOCKED';
    throw err;
  }
  const smoke = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/phase32h-r1-prelaunch-smoke.mjs')],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (smoke.status !== 0) {
    const err = new Error(smoke.stderr || smoke.stdout || 'prelaunch smoke failed');
    err.code = 'PHASE32H_LAUNCH_PREFLIGHT_BLOCKED';
    throw err;
  }
}

export function runBaselineLaunchPreflight(opts, {
  repoRoot = REPO_ROOT,
  skipPreflight = false,
  approvalRecord = null,
  skipSourceDirtyCheck = false,
  skipStaticGuard = false,
  skipSourceReconciliation = false,
  skipDiskPreflight = false,
  headSha = null,
  originMainSha = null,
} = {}) {
  assertLaunchableEvidenceRoot(opts.out);
  assertCollectorExclusivityPreflight({ interface: process.env.PHASE32H_CAPTURE_IFACE || 'bridge100' });
  assertEvidenceRootAbsent(opts.out);

  if (!skipStaticGuard) {
    const staticGuard = evaluatePrelaunchGuard();
    if (staticGuard.status !== 'PASS') {
      const err = new Error(JSON.stringify(staticGuard));
      err.code = 'PHASE32H_LAUNCH_PREFLIGHT_BLOCKED';
      throw err;
    }
  }

  const reconciled = skipSourceReconciliation
    ? { headSha: headSha || 'test-head', originMainSha: originMainSha || headSha || 'test-head' }
    : assertSourceReconciliation(repoRoot);
  const { headSha: resolvedHead, originMainSha: resolvedOrigin } = reconciled;
  if (!skipSourceDirtyCheck) {
    assertCleanLauncherSource(repoRoot);
  }

  if (!opts.canary) {
    assertCiApproval({ headSha: resolvedHead, originMainSha: resolvedOrigin, approvalRecord });
    if (!skipDiskPreflight) {
      assertDiskPreflight(opts.out);
    }
  }

  if (!skipPreflight) {
    runStaticPreflightSmoke(repoRoot);
  }

  const evidenceLabel = evidenceLabelForArm(opts.arm, { canary: opts.canary });
  const runId = `preflight-${Date.now()}`;
  const manifestRows = validateManifestRowsInMemory({
    arm: opts.arm,
    canary: opts.canary,
    evidenceLabel,
    launchHead: resolvedHead,
    runId,
  });

  return {
    headSha: resolvedHead,
    originMainSha: resolvedOrigin,
    evidenceLabel,
    manifestRows,
  };
}
