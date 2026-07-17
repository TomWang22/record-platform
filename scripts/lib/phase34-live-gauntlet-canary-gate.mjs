/**
 * Phase 34 live gauntlet canary-root eligibility and pin checks.
 * Prefer an explicit --canary-root; do not silently fall back to historical canaries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { INTER_BATCH_INTERVAL_MS } from './phase33f-rate-limit.mjs';
import {
  PHASE33F_TARGET_ROOT_FORBIDDEN,
  PHASE34_LIVE_GAUNTLET_ROOT,
} from './phase34-live-gauntlet-config.mjs';

export function blocked(message, details = {}) {
  const err = new Error(message);
  err.code = 'PHASE34_LIVE_GAUNTLET_BLOCKED';
  err.details = details;
  return err;
}

/**
 * @param {string[]} argv
 * @param {{ defaultOut?: string }} [defaults]
 */
export function parseLiveGauntletArgs(argv, defaults = {}) {
  const opts = {
    out: defaults.defaultOut || PHASE34_LIVE_GAUNTLET_ROOT,
    canaryRoot: null,
    skipCanaryGate: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--canary-root') opts.canaryRoot = argv[++i];
    else if (argv[i] === '--skip-canary-gate') opts.skipCanaryGate = true;
  }
  if (!opts.canaryRoot) {
    throw blocked('--canary-root is required (no implicit historical canary fallback)', {
      expected_shape:
        'node scripts/phase34-launch-live-inference-gauntlet.mjs --canary-root <frozen-canary> --out <fresh-gauntlet>',
    });
  }
  if (!opts.out || typeof opts.out !== 'string') {
    throw blocked('--out is required');
  }
  return opts;
}

export function assertGauntletOutEligible(out) {
  if (!out.startsWith('/tmp/')) {
    throw blocked('out must be under /tmp', { out });
  }
  if (out === PHASE33F_TARGET_ROOT_FORBIDDEN) {
    throw blocked('Phase 33F target root is forbidden', { out });
  }
  if (fs.existsSync(PHASE33F_TARGET_ROOT_FORBIDDEN)) {
    throw blocked('Phase 33F target root must remain ABSENT', {
      path: PHASE33F_TARGET_ROOT_FORBIDDEN,
    });
  }
  if (fs.existsSync(out)) {
    throw blocked(`gauntlet evidence root must be absent: ${out}`, { out });
  }
}

/**
 * Fail-closed eligibility for the frozen canary that authorizes the full gauntlet.
 * @param {string} canaryRoot
 */
export function assertCanaryRootEligible(canaryRoot) {
  if (!canaryRoot || typeof canaryRoot !== 'string') {
    throw blocked('canary root path required', { canaryRoot });
  }
  if (!fs.existsSync(canaryRoot)) {
    throw blocked('canary root does not exist', { canaryRoot });
  }
  const pass = path.join(canaryRoot, 'FROZEN_PASS_EVIDENCE');
  const blockedMarker = path.join(canaryRoot, 'FROZEN_BLOCKED_EVIDENCE');
  if (fs.existsSync(blockedMarker)) {
    throw blocked('canary is FROZEN_BLOCKED — cannot continue', {
      canaryRoot,
      marker: blockedMarker,
    });
  }
  if (!fs.existsSync(pass)) {
    throw blocked('canary FROZEN_PASS_EVIDENCE required before full gauntlet', {
      expected: pass,
    });
  }
}

/**
 * Compare canary launch pins against the current source SHA and rate policy.
 * @param {{ canaryRoot: string, headSha: string, expectedInterBatchIntervalMs?: number }} args
 */
export function assertCanaryPinsMatch({
  canaryRoot,
  headSha,
  expectedInterBatchIntervalMs = INTER_BATCH_INTERVAL_MS,
} = {}) {
  const launch = path.join(canaryRoot, 'phase33f-launch.json');
  if (!fs.existsSync(launch)) {
    throw blocked('canary launch pin missing', { launch });
  }
  const doc = JSON.parse(fs.readFileSync(launch, 'utf8'));
  if (!doc.launch_head) {
    throw blocked('canary launch_head missing', { launch });
  }
  if (doc.launch_head !== headSha) {
    throw blocked(`source SHA changed since canary (${doc.launch_head} → ${headSha})`, {
      canary_launch_head: doc.launch_head,
      head: headSha,
    });
  }
  if (doc.inter_batch_interval_ms != null && Number(doc.inter_batch_interval_ms) !== expectedInterBatchIntervalMs) {
    throw blocked('canary pacing policy pin differs from current rate policy', {
      canary_inter_batch_interval_ms: doc.inter_batch_interval_ms,
      expected_inter_batch_interval_ms: expectedInterBatchIntervalMs,
    });
  }
  if (!doc.manifest_sha256 || typeof doc.manifest_sha256 !== 'string') {
    throw blocked('canary manifest_sha256 pin missing', { launch });
  }
  return {
    head: headSha,
    canary_launch_head: doc.launch_head,
    manifest_sha256: doc.manifest_sha256,
    inter_batch_interval_ms: doc.inter_batch_interval_ms ?? expectedInterBatchIntervalMs,
  };
}
