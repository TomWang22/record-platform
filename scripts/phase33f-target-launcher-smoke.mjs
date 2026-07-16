#!/usr/bin/env node
/**
 * Phase 33F — committed target-launcher smoke (live H1/H2/H3).
 *
 * Hardcoded: 24 synchronized triplets / 72 probes / 3 batches per capability.
 * Root: /tmp/phase33f-target-launcher-smoke-v1
 * NEVER accepts /tmp/phase33f-capability-gauntlet-target-v1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REAL_TARGET_ROOT,
  TARGET_SMOKE_ROOT,
  TARGET_SMOKE,
  FROZEN_CANARY_V3_ROOT,
} from './lib/phase33f-canary-config.mjs';
import { buildCanaryManifest, hashManifest, auditProductionMutationRows } from './lib/phase33f-canary-manifest.mjs';
import { runPhase33fCapabilityLaunch } from './lib/phase33f-capability-launch-core.mjs';
import { liveAuthSmoke } from './lib/phase33f-auth-smoke.mjs';
import { liveQuicPcapPreflight } from './lib/phase33f-quic-pcap-preflight.mjs';
import { defaultEdgeHealthCheck } from './lib/phase33f-canary-preflight.mjs';
import { verifyFrozenCanaryV3 } from './lib/phase33f-frozen-canary-v3.mjs';
import { INTER_BATCH_INTERVAL_MS } from './lib/phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const SMOKE_BATCHES_PER_CAPABILITY = 3;

async function main() {
  if (fs.existsSync(REAL_TARGET_ROOT)) {
    throw new Error(`refusing smoke while real target root exists: ${REAL_TARGET_ROOT}`);
  }

  const out = process.env.PHASE33F_TARGET_SMOKE_OUT || TARGET_SMOKE_ROOT;
  if (out === REAL_TARGET_ROOT) {
    throw new Error('target-launcher smoke must never use the real target root');
  }
  if (!out.startsWith('/tmp/')) {
    throw new Error('smoke out must be under /tmp');
  }
  if (fs.existsSync(out)) {
    throw new Error(`smoke root must be absent: ${out}`);
  }

  // Preserve frozen canary-v3 (read-only verify).
  if (fs.existsSync(FROZEN_CANARY_V3_ROOT)) {
    verifyFrozenCanaryV3({ root: FROZEN_CANARY_V3_ROOT });
  }

  const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();

  if (process.env.PHASE33F_TARGET_SMOKE_SKIP_LIVE !== '1') {
    defaultEdgeHealthCheck({ repoRoot: REPO_ROOT });
    const auth = await Promise.resolve(liveAuthSmoke({ mode: 'smoke', repoRoot: REPO_ROOT }));
    if (auth?.status && auth.status !== 'PASS') {
      throw new Error(`auth smoke failed: ${JSON.stringify(auth)}`);
    }
    const quic = await Promise.resolve(
      liveQuicPcapPreflight({ mode: 'smoke', repoRoot: REPO_ROOT, out }),
    );
    if (quic?.status && quic.status !== 'PASS') {
      throw new Error(`quic/pcap preflight failed: ${JSON.stringify(quic)}`);
    }
  }

  const rows = buildCanaryManifest({ batchesPerCapability: SMOKE_BATCHES_PER_CAPABILITY });
  if (rows.length !== TARGET_SMOKE.probes) {
    throw new Error(`smoke probe count ${rows.length} != ${TARGET_SMOKE.probes}`);
  }
  const audit = auditProductionMutationRows(rows);
  if (audit.status !== 'PASS') {
    throw new Error(`smoke production mutation audit failed: ${JSON.stringify(audit)}`);
  }
  const manifestSha = hashManifest(rows);

  // Quiet limiter window before live matrix (skip when offline).
  if (process.env.PHASE33F_TARGET_SMOKE_SKIP_LIVE !== '1') {
    const quietS = Number(process.env.PHASE33F_TARGET_SMOKE_QUIET_S || 65);
    spawnSync('sleep', [String(quietS)], { encoding: 'utf8' });
  }

  const { pass, launchRecord, runnerResult, verdict } = await runPhase33fCapabilityLaunch({
    out,
    mode: 'target-smoke',
    rows,
    manifestSha,
    headSha,
    repoRoot: REPO_ROOT,
    interBatchIntervalMs: INTER_BATCH_INTERVAL_MS,
    enforceTargetPacing: true,
    evidenceLabel: 'Phase 33F target-launcher smoke (H1/H2/H3)',
    verdictDelayMs: Number(process.env.PHASE33F_VERDICT_DELAY_MS || 5000),
  });

  const report = {
    ...launchRecord,
    smoke: {
      probes: TARGET_SMOKE.probes,
      batches: TARGET_SMOKE.batches,
      h1_h2_h3: [TARGET_SMOKE.perProtocol, TARGET_SMOKE.perProtocol, TARGET_SMOKE.perProtocol],
      batches_per_capability: SMOKE_BATCHES_PER_CAPABILITY,
      real_target_root: REAL_TARGET_ROOT,
      real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
      frozen_pass: fs.existsSync(path.join(out, 'FROZEN_PASS_EVIDENCE')),
      frozen_blocked: fs.existsSync(path.join(out, 'FROZEN_BLOCKED_EVIDENCE')),
      runner_status: runnerResult?.status,
      verdict_status: verdict?.status,
    },
  };
  fs.mkdirSync('/tmp/phase33f-target-launcher-implementation', { recursive: true });
  fs.writeFileSync(
    '/tmp/phase33f-target-launcher-implementation/target-launcher-smoke-report.json',
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(2);
  if (fs.existsSync(REAL_TARGET_ROOT)) {
    console.error('FATAL: real target root appeared during smoke');
    process.exit(3);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(JSON.stringify({ status: 'BLOCKED', message: err.message, code: err.code || null }, null, 2));
    process.exit(1);
  });
}

export { main };
