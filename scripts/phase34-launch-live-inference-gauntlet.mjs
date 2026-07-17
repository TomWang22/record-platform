#!/usr/bin/env node
/**
 * Phase 34 — live intelligence gauntlet (20,000 unique logical sessions × H1/H2/H3).
 *
 * Prerequisites:
 *   - PKI gate PASS (scripts/security/verify-rp-pki-chain.mjs)
 *   - Canary FROZEN_PASS at /tmp/phase34-live-inference-canary-v1
 *   - Phase 33F target root ABSENT
 *
 * Never launches /tmp/phase33f-capability-gauntlet-target-v1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PHASE34_LIVE_GAUNTLET,
  PHASE34_LIVE_GAUNTLET_ROOT,
  PHASE34_LIVE_CANARY_ROOT,
  PHASE33F_TARGET_ROOT_FORBIDDEN,
} from './lib/phase34-live-gauntlet-config.mjs';
import {
  buildCanaryManifest,
  hashManifest,
  validateManifestRows,
  auditProductionMutationRows,
} from './lib/phase33f-canary-manifest.mjs';
import { runPhase33fCapabilityLaunch } from './lib/phase33f-capability-launch-core.mjs';
import { assertCiApproval, assertSourceReconciliation } from './lib/phase32h-ci-approval.mjs';
import { assertDiskPreflight } from './lib/phase32h-disk-preflight.mjs';
import { assertCollectorExclusivityPreflight } from './lib/phase32h-collector-exclusivity.mjs';
import { INTER_BATCH_INTERVAL_MS } from './lib/phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function blocked(message, details = {}) {
  const err = new Error(message);
  err.code = 'PHASE34_LIVE_GAUNTLET_BLOCKED';
  err.details = details;
  return err;
}

function parseArgs(argv) {
  const opts = { out: PHASE34_LIVE_GAUNTLET_ROOT, skipCanaryGate: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--skip-canary-gate') opts.skipCanaryGate = true;
  }
  return opts;
}

function assertPinsUnchanged(canaryRoot) {
  const launch = path.join(canaryRoot, 'phase33f-launch.json');
  if (!fs.existsSync(launch)) {
    throw blocked('canary launch pin missing', { launch });
  }
  const doc = JSON.parse(fs.readFileSync(launch, 'utf8'));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  if (doc.launch_head && doc.launch_head !== head) {
    throw blocked(`source SHA changed since canary (${doc.launch_head} → ${head})`);
  }
  return { head, canary_launch_head: doc.launch_head || head };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) {
    throw blocked('out must be under /tmp');
  }
  if (opts.out === PHASE33F_TARGET_ROOT_FORBIDDEN) {
    throw blocked('Phase 33F target root is forbidden');
  }
  if (fs.existsSync(PHASE33F_TARGET_ROOT_FORBIDDEN)) {
    throw blocked('Phase 33F target root must remain ABSENT', {
      path: PHASE33F_TARGET_ROOT_FORBIDDEN,
    });
  }
  if (fs.existsSync(opts.out)) {
    throw blocked(`gauntlet evidence root must be absent: ${opts.out}`);
  }

  if (!opts.skipCanaryGate) {
    const pass = path.join(PHASE34_LIVE_CANARY_ROOT, 'FROZEN_PASS_EVIDENCE');
    const blockedMarker = path.join(PHASE34_LIVE_CANARY_ROOT, 'FROZEN_BLOCKED_EVIDENCE');
    if (fs.existsSync(blockedMarker)) {
      throw blocked('canary is FROZEN_BLOCKED — cannot continue');
    }
    if (!fs.existsSync(pass)) {
      throw blocked('canary FROZEN_PASS_EVIDENCE required before full gauntlet', {
        expected: pass,
      });
    }
  }

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  if (headSha !== originMainSha) {
    throw blocked(`HEAD ${headSha} != origin/main ${originMainSha}`);
  }
  assertCiApproval({ headSha, originMainSha });
  const pins = assertPinsUnchanged(PHASE34_LIVE_CANARY_ROOT);

  const rows = buildCanaryManifest({
    batchesPerCapability: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
  });
  const validation = validateManifestRows(rows, {
    expectedProbes: PHASE34_LIVE_GAUNTLET.probes,
    expectedBatches: PHASE34_LIVE_GAUNTLET.batches,
    batchesPerCapability: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
  });
  if (validation.status !== 'PASS') {
    throw blocked('manifest validation failed', { violations: validation.violations?.slice?.(0, 20) });
  }
  const audit = auditProductionMutationRows(rows);
  if (audit.status !== 'PASS') {
    throw blocked('production mutation audit failed', audit);
  }
  const manifestSha = hashManifest(rows);

  assertDiskPreflight(opts.out);
  assertCollectorExclusivityPreflight({
    interface: process.env.PHASE32H_CAPTURE_IFACE || 'bridge100',
  });

  const result = await runPhase33fCapabilityLaunch({
    out: opts.out,
    mode: 'canary',
    rows,
    manifestSha,
    headSha: pins.head,
    repoRoot: REPO_ROOT,
    interBatchIntervalMs: INTER_BATCH_INTERVAL_MS,
    batchesPerCapabilityOverride: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
    evidenceLabel: 'Phase 34 live intelligence gauntlet (20k logical / 60k protocol)',
    caCert: path.join(REPO_ROOT, 'certs/dev-chain.pem'),
  });

  console.log(
    JSON.stringify(
      {
        status: result?.status || result?.freeze?.status || 'UNKNOWN',
        phase: '34',
        mode: 'live-gauntlet',
        out: opts.out,
        logical_sessions: PHASE34_LIVE_GAUNTLET.batches,
        protocol_probes: PHASE34_LIVE_GAUNTLET.probes,
        batches_per_capability: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
        MODEL_WEIGHT_TRAINING: PHASE34_LIVE_GAUNTLET.MODEL_WEIGHT_TRAINING,
        OPTIMIZATION: PHASE34_LIVE_GAUNTLET.OPTIMIZATION,
        PERCENT: 0,
        ALLOW_PROD_PERCENT: 0,
        phase33f_target_exists: fs.existsSync(PHASE33F_TARGET_ROOT_FORBIDDEN),
        result,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        status: 'BLOCKED',
        code: err.code || 'PHASE34_LIVE_GAUNTLET_ERROR',
        message: err.message,
        details: err.details || null,
      },
      null,
      2,
    ),
  );
  process.exit(2);
});
