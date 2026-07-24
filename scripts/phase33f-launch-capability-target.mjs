#!/usr/bin/env node
/**
 * Phase 33F — committed capability-gauntlet TARGET launcher.
 *
 * Requires:
 *   PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_SHA === HEAD
 *   PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_ROOT === /tmp/phase33f-capability-gauntlet-target-v1
 *
 * Canary PHASE33F_OWNER_LAUNCH_APPROVED_SHA never authorizes this path.
 * Does not expose a CLI probe-count override.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REAL_TARGET_ROOT, TARGET } from './lib/phase33f-canary-config.mjs';
import {
  runPhase33fTargetPreflight,
  TARGET_PRELAUNCH_BLOCKED_CODE,
  probeLimiterWindowReadiness,
} from './lib/phase33f-target-preflight.mjs';
import { runPhase33fCapabilityLaunch } from './lib/phase33f-capability-launch-core.mjs';
import { liveAuthSmoke } from './lib/phase33f-auth-smoke.mjs';
import { liveQuicPcapPreflight } from './lib/phase33f-quic-pcap-preflight.mjs';
import {
  offlineAuthSmokeStub,
  offlineQuicPcapPreflightStub,
} from './lib/phase33f-canary-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    out: REAL_TARGET_ROOT,
    mode: 'target',
    skipPreflight: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--skip-preflight') opts.skipPreflight = true;
    else if (a === '--limit') {
      const err = new Error('target launcher rejects --limit (no CLI count override)');
      err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
      throw err;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode !== 'target') {
    const err = new Error(`target launcher rejects mode=${opts.mode}`);
    err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
  if (opts.out !== REAL_TARGET_ROOT) {
    const err = new Error(`target launcher out must equal ${REAL_TARGET_ROOT}`);
    err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
    throw err;
  }
  if (fs.existsSync(REAL_TARGET_ROOT)) {
    const err = new Error(`existing target root blocks launch: ${REAL_TARGET_ROOT}`);
    err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
    throw err;
  }

  let preflight = {
    headSha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim(),
    manifest_rows: null,
    manifest_sha: null,
  };

  if (!opts.skipPreflight) {
    preflight = runPhase33fTargetPreflight({
      out: opts.out,
      mode: 'target',
      repoRoot: REPO_ROOT,
      skipDirtySourceCheck: process.env.PHASE33F_ALLOW_DIRTY_LAUNCHER === '1',
      skipEdgeHealth: process.env.PHASE33F_PREFLIGHT_OFFLINE === '1',
      skipOfflineVerify: process.env.PHASE33F_SKIP_OFFLINE_VERIFY === '1',
      skipCoverage: process.env.PHASE33F_SKIP_COVERAGE === '1',
      skipSemantic: process.env.PHASE33F_SKIP_SEMANTIC === '1',
      skipDiskPreflight: process.env.PHASE33F_SKIP_DISK === '1',
      skipCollectorExclusivity: process.env.PHASE33F_SKIP_EXCLUSIVITY === '1',
      skipCanaryV3: process.env.PHASE33F_SKIP_CANARY_V3 === '1',
      skipRateCapacityProof: process.env.PHASE33F_SKIP_RATE_CAPACITY === '1',
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

    if (process.env.PHASE33F_SKIP_LIMITER_WINDOW !== '1' && process.env.PHASE33F_PREFLIGHT_OFFLINE !== '1') {
      const limiter = probeLimiterWindowReadiness({ repoRoot: REPO_ROOT });
      const pinDir = '/tmp/phase33f-target-v1-prelaunch';
      fs.mkdirSync(pinDir, { recursive: true });
      fs.writeFileSync(
        path.join(pinDir, 'limiter-window-readiness.json'),
        `${JSON.stringify(limiter, null, 2)}\n`,
        'utf8',
      );
    }
  }

  if (!preflight.manifest_rows?.length || !preflight.manifest_sha) {
    throw Object.assign(new Error('target preflight missing pinned manifest'), {
      code: TARGET_PRELAUNCH_BLOCKED_CODE,
    });
  }

  const { pass, launchRecord } = await runPhase33fCapabilityLaunch({
    out: opts.out,
    mode: 'target',
    rows: preflight.manifest_rows,
    manifestSha: preflight.manifest_sha,
    headSha: preflight.headSha,
    repoRoot: REPO_ROOT,
    interBatchIntervalMs: TARGET.inter_batch_interval_ms,
    enforceTargetPacing: true,
    evidenceLabel: 'Phase 33F target capability gauntlet',
  });

  console.log(JSON.stringify(launchRecord, null, 2));
  if (!pass) process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    const payload = {
      status: 'BLOCKED',
      code: err.code || TARGET_PRELAUNCH_BLOCKED_CODE,
      message: err.message,
      details: err.details || null,
      real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
      target_root: REAL_TARGET_ROOT,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(err.code === TARGET_PRELAUNCH_BLOCKED_CODE ? 3 : 1);
  });
}

export { parseArgs, main };
