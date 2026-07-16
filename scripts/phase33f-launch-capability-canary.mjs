#!/usr/bin/env node
/**
 * Phase 33F — committed capability-gauntlet canary / smoke launcher.
 * Does NOT create REAL_CANARY_ROOT unless PHASE33F_OWNER_LAUNCH_APPROVED_SHA === HEAD.
 * Never launches REAL_TARGET_ROOT (dedicated target launcher only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
  SMOKE_ROOT,
  dimensionsForMode,
  isRealGauntletRoot,
} from './lib/phase33f-canary-config.mjs';
import {
  runPhase33fCanaryPreflight,
  assertRealGauntletRootsAbsent,
  offlineAuthSmokeStub,
  offlineQuicPcapPreflightStub,
  PRELAUNCH_BLOCKED_CODE,
} from './lib/phase33f-canary-preflight.mjs';
import { liveAuthSmoke } from './lib/phase33f-auth-smoke.mjs';
import { liveQuicPcapPreflight } from './lib/phase33f-quic-pcap-preflight.mjs';
import { runPhase33fCapabilityLaunch } from './lib/phase33f-capability-launch-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    out: null,
    mode: 'smoke',
    skipPreflight: false,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--skip-preflight') opts.skipPreflight = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
  }
  if (!opts.out) {
    opts.out = opts.mode === 'smoke' ? SMOKE_ROOT : REAL_CANARY_ROOT;
  }
  return opts;
}

function refuseRealRootWithoutOwnerApproval(out, headSha) {
  if (!isRealGauntletRoot(out)) return;
  const approved = process.env.PHASE33F_OWNER_LAUNCH_APPROVED_SHA || '';
  if (!approved || approved !== headSha) {
    const err = new Error(
      `refusing to create ${out}: PHASE33F_OWNER_LAUNCH_APPROVED_SHA must equal HEAD (${headSha})`,
    );
    err.code = PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
  if (out === REAL_TARGET_ROOT) {
    const err = new Error('target root launch is not authorized from canary launcher');
    err.code = PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
}

function refuseTargetOrSoakMode(mode) {
  if (mode === 'target' || mode === 'soak') {
    const err = new Error(
      `canary launcher rejects mode=${mode}; use scripts/phase33f-launch-capability-target.mjs for target`,
    );
    err.code = PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) {
    throw new Error('out must be under /tmp');
  }

  refuseTargetOrSoakMode(opts.mode);
  assertRealGauntletRootsAbsent();

  let preflight = {
    headSha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim(),
    originMainSha: null,
    manifest_rows: null,
    manifest_sha: null,
  };

  if (!opts.skipPreflight) {
    preflight = runPhase33fCanaryPreflight({
      out: opts.out,
      mode: opts.mode,
      repoRoot: REPO_ROOT,
      skipCiApproval: opts.mode === 'smoke',
      skipDirtySourceCheck: process.env.PHASE33F_ALLOW_DIRTY_LAUNCHER === '1',
      skipEdgeHealth: process.env.PHASE33F_PREFLIGHT_OFFLINE === '1',
      skipOfflineVerify: process.env.PHASE33F_SKIP_OFFLINE_VERIFY === '1',
      skipCoverage: process.env.PHASE33F_SKIP_COVERAGE === '1',
      skipSemantic: process.env.PHASE33F_SKIP_SEMANTIC === '1',
      skipAttribution: process.env.PHASE33F_SKIP_ATTRIBUTION === '1',
      skipDiskPreflight: opts.mode === 'smoke' || process.env.PHASE33F_SKIP_DISK === '1',
      skipCollectorExclusivity: process.env.PHASE33F_SKIP_EXCLUSIVITY === '1',
      ...(process.env.PHASE33F_PREFLIGHT_OFFLINE === '1'
        ? {
            runAuthSmoke: offlineAuthSmokeStub,
            runQuicPcapPreflight: offlineQuicPcapPreflightStub,
          }
        : {
            runAuthSmoke: liveAuthSmoke,
            runQuicPcapPreflight: liveQuicPcapPreflight,
          }),
    });
  }

  refuseRealRootWithoutOwnerApproval(opts.out, preflight.headSha);

  const dims = dimensionsForMode(opts.mode);
  const rows = preflight.manifest_rows;
  if (!rows?.length) {
    throw new Error('preflight did not return manifest rows; refuse launch without validated manifest');
  }
  const manifestSha = preflight.manifest_sha;
  if (!manifestSha) {
    throw new Error('preflight did not return manifest_sha');
  }

  const { pass, launchRecord } = await runPhase33fCapabilityLaunch({
    out: opts.out,
    mode: opts.mode,
    rows,
    manifestSha,
    headSha: preflight.headSha,
    repoRoot: REPO_ROOT,
    limit: opts.limit,
    interBatchIntervalMs: opts.mode === 'canary' ? dims.inter_batch_interval_ms : undefined,
    evidenceLabel: `Phase 33F ${opts.mode} capability gauntlet`,
  });

  launchRecord.real_canary_root = REAL_CANARY_ROOT;
  launchRecord.real_canary_exists = fs.existsSync(REAL_CANARY_ROOT);
  launchRecord.real_target_exists = fs.existsSync(REAL_TARGET_ROOT);
  fs.writeFileSync(
    path.join(opts.out, 'phase33f-launch.json'),
    `${JSON.stringify(launchRecord, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(launchRecord, null, 2));
  if (!pass) process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    const payload = {
      status: 'BLOCKED',
      code: err.code || PRELAUNCH_BLOCKED_CODE,
      message: err.message,
      details: err.details || null,
      real_canary_exists: fs.existsSync(REAL_CANARY_ROOT),
      real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(err.code === PRELAUNCH_BLOCKED_CODE ? 3 : 1);
  });
}

export { parseArgs, refuseRealRootWithoutOwnerApproval, refuseTargetOrSoakMode, main };
