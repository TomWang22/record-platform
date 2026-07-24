#!/usr/bin/env node
/**
 * Phase 33F target preflight verifier (offline failure paths).
 * Never creates /tmp/phase33f-capability-gauntlet-target-v1.
 */
import fs from 'node:fs';
import {
  runPhase33fTargetPreflight,
  TARGET_PRELAUNCH_BLOCKED_CODE,
} from '../lib/phase33f-target-preflight.mjs';
import {
  REAL_TARGET_ROOT,
  TARGET_APPROVAL_SHA_ENV,
  TARGET_APPROVAL_ROOT_ENV,
} from '../lib/phase33f-canary-config.mjs';

const violations = [];
const HEAD = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function base(overrides = {}) {
  return {
    out: REAL_TARGET_ROOT,
    mode: 'target',
    skipSourceReconciliation: true,
    headSha: HEAD,
    originMainSha: HEAD,
    skipCiApproval: true,
    skipDirtySourceCheck: true,
    skipOfflineVerify: true,
    skipSemantic: true,
    skipCoverage: true,
    skipDiskPreflight: true,
    skipCollectorExclusivity: true,
    skipEdgeHealth: true,
    skipCanaryV3: true,
    skipOwnerApproval: true,
    skipRateCapacityProof: true,
    runAuthSmoke: () => ({ status: 'PASS' }),
    runQuicPcapPreflight: () => ({ status: 'PASS' }),
    ...overrides,
  };
}

function expectBlock(label, overrides) {
  try {
    runPhase33fTargetPreflight(base(overrides));
    violations.push(`expected_block:${label}`);
  } catch (err) {
    if (err.code !== TARGET_PRELAUNCH_BLOCKED_CODE) {
      violations.push(`wrong_code:${label}:${err.code}`);
    }
  }
  if (fs.existsSync(REAL_TARGET_ROOT)) {
    violations.push(`target_created_on:${label}`);
  }
}

expectBlock('missing_owner_sha', {
  skipOwnerApproval: false,
  env: { [TARGET_APPROVAL_ROOT_ENV]: REAL_TARGET_ROOT },
});
expectBlock('canary_sha_only', {
  skipOwnerApproval: false,
  env: { PHASE33F_OWNER_LAUNCH_APPROVED_SHA: HEAD },
});
expectBlock('wrong_root', {
  skipOwnerApproval: false,
  env: {
    [TARGET_APPROVAL_SHA_ENV]: HEAD,
    [TARGET_APPROVAL_ROOT_ENV]: '/tmp/not-the-target',
  },
});
expectBlock('soak_mode', { mode: 'soak' });
expectBlock('interval_low', { interBatchIntervalMs: 100 });

try {
  const ok = runPhase33fTargetPreflight(base());
  if (ok.status !== 'PASS') violations.push('expected_pass_mocked');
  if (ok.real_target_root_created !== false) violations.push('preflight_claimed_create');
} catch (err) {
  violations.push(`unexpected_pass_fail:${err.message}`);
}
if (fs.existsSync(REAL_TARGET_ROOT)) violations.push('target_root_exists_after_pass');

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  target_root_exists: fs.existsSync(REAL_TARGET_ROOT),
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
