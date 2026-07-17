#!/usr/bin/env node
/**
 * Phase 34 — live intelligence gauntlet (20,000 unique logical sessions × H1/H2/H3).
 *
 * Prerequisites:
 *   - PKI gate PASS (scripts/security/verify-rp-pki-chain.mjs)
 *   - Explicit frozen canary via --canary-root (e.g. /tmp/phase34-live-inference-canary-v3)
 *   - Phase 33F target root ABSENT
 *
 * Never launches /tmp/phase33f-capability-gauntlet-target-v1.
 * Never silently selects a historical canary (v1/v2); --canary-root is required.
 *
 * Example:
 *   node scripts/phase34-launch-live-inference-gauntlet.mjs \
 *     --canary-root /tmp/phase34-live-inference-canary-v3 \
 *     --out /tmp/phase34-live-inference-gauntlet-v2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASE34_LIVE_GAUNTLET,
  PHASE34_LIVE_GAUNTLET_ROOT,
  PHASE33F_TARGET_ROOT_FORBIDDEN,
} from './lib/phase34-live-gauntlet-config.mjs';
import {
  parseLiveGauntletArgs,
  assertGauntletOutEligible,
  assertCanaryRootEligible,
  assertCanaryPinsMatch,
} from './lib/phase34-live-gauntlet-canary-gate.mjs';
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

async function main() {
  const opts = parseLiveGauntletArgs(process.argv.slice(2), {
    defaultOut: PHASE34_LIVE_GAUNTLET_ROOT,
  });
  assertGauntletOutEligible(opts.out);

  if (!opts.skipCanaryGate) {
    assertCanaryRootEligible(opts.canaryRoot);
  }

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  if (headSha !== originMainSha) {
    const err = new Error(`HEAD ${headSha} != origin/main ${originMainSha}`);
    err.code = 'PHASE34_LIVE_GAUNTLET_BLOCKED';
    throw err;
  }
  assertCiApproval({ headSha, originMainSha });
  const pins = assertCanaryPinsMatch({
    canaryRoot: opts.canaryRoot,
    headSha,
    expectedInterBatchIntervalMs: INTER_BATCH_INTERVAL_MS,
  });

  const rows = buildCanaryManifest({
    batchesPerCapability: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
  });
  const validation = validateManifestRows(rows, {
    expectedProbes: PHASE34_LIVE_GAUNTLET.probes,
    expectedBatches: PHASE34_LIVE_GAUNTLET.batches,
    batchesPerCapability: PHASE34_LIVE_GAUNTLET.batchesPerCapability,
  });
  if (validation.status !== 'PASS') {
    const err = new Error('manifest validation failed');
    err.code = 'PHASE34_LIVE_GAUNTLET_BLOCKED';
    err.details = { violations: validation.violations?.slice?.(0, 20) };
    throw err;
  }
  const audit = auditProductionMutationRows(rows);
  if (audit.status !== 'PASS') {
    const err = new Error('production mutation audit failed');
    err.code = 'PHASE34_LIVE_GAUNTLET_BLOCKED';
    err.details = audit;
    throw err;
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
        canary_root: opts.canaryRoot,
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
