#!/usr/bin/env node
/**
 * Phase 33F canary preflight verifier.
 * With PHASE33F_PREFLIGHT_OFFLINE=1, skips live edge and proves root remains absent on forced failures.
 * Frozen canary-v1 evidence is allowed to remain present (immutable; never resumed).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  runPhase33fCanaryPreflight,
  assertRealGauntletRootsAbsent,
  PRELAUNCH_BLOCKED_CODE,
} from '../lib/phase33f-canary-preflight.mjs';
import { REAL_CANARY_ROOT, SMOKE_ROOT } from '../lib/phase33f-canary-config.mjs';

const offline = process.env.PHASE33F_PREFLIGHT_OFFLINE === '1';
const violations = [];

function isFrozen(root) {
  return (
    fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE')) ||
    fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE'))
  );
}

/** Live (non-frozen) canary root must not appear; frozen canary-v1 evidence is allowed. */
function liveCanaryRootAbsent() {
  if (!fs.existsSync(REAL_CANARY_ROOT)) return true;
  return isFrozen(REAL_CANARY_ROOT);
}

try {
  assertRealGauntletRootsAbsent();
} catch (err) {
  violations.push(`real_roots_present:${err.message}`);
}

// Forced failure: HEAD drift — must not create/unfreeze a live canary root
try {
  runPhase33fCanaryPreflight({
    out: REAL_CANARY_ROOT,
    mode: 'canary',
    skipSourceReconciliation: true,
    headSha: 'drift-head-aaaa',
    originMainSha: 'origin-main-bbbb',
    skipCiApproval: true,
    skipDirtySourceCheck: true,
    skipOfflineVerify: true,
    skipSemantic: true,
    skipCoverage: true,
    skipDiskPreflight: true,
    skipCollectorExclusivity: true,
    skipEdgeHealth: true,
    skipManifest: true,
    runAuthSmoke: () => ({ status: 'PASS' }),
    runQuicPcapPreflight: () => ({ status: 'PASS' }),
  });
  violations.push('expected_head_drift_block');
} catch (err) {
  if (err.code !== PRELAUNCH_BLOCKED_CODE) {
    violations.push(`head_drift_wrong_code:${err.code}`);
  }
  if (!liveCanaryRootAbsent()) violations.push('canary_root_created_on_head_drift');
}

// Forced failure: missing CI approval
try {
  runPhase33fCanaryPreflight({
    out: REAL_CANARY_ROOT,
    mode: 'canary',
    skipSourceReconciliation: true,
    headSha: 'dddddddddddddddddddddddddddddddddddddddd',
    originMainSha: 'dddddddddddddddddddddddddddddddddddddddd',
    skipCiApproval: false,
    approvalRecord: {
      sha: 'dddddddddddddddddddddddddddddddddddddddd',
      origin_main_sha: 'dddddddddddddddddddddddddddddddddddddddd',
      all_required_terminal_green: false,
      required_workflows: [],
      workflow_rows: [],
    },
    skipDirtySourceCheck: true,
    skipOfflineVerify: true,
    skipSemantic: true,
    skipCoverage: true,
    skipDiskPreflight: true,
    skipCollectorExclusivity: true,
    skipEdgeHealth: true,
    skipManifest: true,
    runAuthSmoke: () => ({ status: 'PASS' }),
    runQuicPcapPreflight: () => ({ status: 'PASS' }),
  });
  violations.push('expected_ci_approval_block');
} catch (err) {
  if (err.code !== PRELAUNCH_BLOCKED_CODE) {
    violations.push(`ci_approval_wrong_code:${err.code}`);
  }
  if (!liveCanaryRootAbsent()) violations.push('canary_root_created_on_missing_approval');
}

// Offline happy-path smoke preflight (no real root)
if (offline) {
  try {
    const pass = runPhase33fCanaryPreflight({
      out: `${SMOKE_ROOT}-preflight-check`,
      mode: 'smoke',
      skipSourceReconciliation: true,
      headSha: 'test-head',
      originMainSha: 'test-head',
      skipCiApproval: true,
      skipDirtySourceCheck: true,
      skipOfflineVerify: true,
      skipSemantic: true,
      skipCoverage: true,
      skipDiskPreflight: true,
      skipCollectorExclusivity: true,
      skipEdgeHealth: true,
      runAuthSmoke: () => ({ status: 'PASS' }),
      runQuicPcapPreflight: () => ({ status: 'PASS' }),
    });
    if (pass.status !== 'PASS') violations.push('offline_smoke_preflight_not_pass');
    if (!liveCanaryRootAbsent()) violations.push('canary_root_created_during_offline_pass');
    if (pass.real_canary_root_created) violations.push('flag_real_canary_created');
  } catch (err) {
    violations.push(`offline_smoke_preflight:${err.message}`);
  }
}

const out = {
  status: violations.length ? 'FAIL' : 'PASS',
  offline,
  canary_root_exists: fs.existsSync(REAL_CANARY_ROOT),
  canary_root_frozen: fs.existsSync(REAL_CANARY_ROOT) && isFrozen(REAL_CANARY_ROOT),
  violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(violations.length ? 2 : 0);
