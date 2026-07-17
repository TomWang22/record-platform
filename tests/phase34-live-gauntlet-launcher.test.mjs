import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseLiveGauntletArgs,
  assertGauntletOutEligible,
  assertCanaryRootEligible,
  assertCanaryPinsMatch,
} from '../scripts/lib/phase34-live-gauntlet-canary-gate.mjs';
import { PHASE33F_TARGET_ROOT_FORBIDDEN } from '../scripts/lib/phase34-live-gauntlet-config.mjs';
import { INTER_BATCH_INTERVAL_MS } from '../scripts/lib/phase33f-rate-limit.mjs';

const launcher = fs.readFileSync(
  new URL('../scripts/phase34-launch-live-inference-gauntlet.mjs', import.meta.url),
  'utf8',
);

function mkCanary({
  frozenPass = true,
  frozenBlocked = false,
  launchHead = 'abc123',
  manifestSha = 'deadbeef',
  interBatch = INTER_BATCH_INTERVAL_MS,
  writeLaunch = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-canary-gate-'));
  if (frozenPass) fs.writeFileSync(path.join(root, 'FROZEN_PASS_EVIDENCE'), 'ok\n');
  if (frozenBlocked) fs.writeFileSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE'), 'blocked\n');
  if (writeLaunch) {
    fs.writeFileSync(
      path.join(root, 'phase33f-launch.json'),
      JSON.stringify({
        status: frozenPass ? 'PASS' : 'BLOCKED',
        launch_head: launchHead,
        manifest_sha256: manifestSha,
        inter_batch_interval_ms: interBatch,
        mode: 'canary',
      }),
    );
  }
  return root;
}

test('launcher requires explicit --canary-root and uses gate helpers', () => {
  assert.match(launcher, /--canary-root/);
  assert.match(launcher, /parseLiveGauntletArgs/);
  assert.match(launcher, /assertCanaryRootEligible/);
  assert.match(launcher, /assertCanaryPinsMatch/);
  assert.doesNotMatch(launcher, /PHASE34_LIVE_CANARY_ROOT/);
  assert.doesNotMatch(launcher, /assertPinsUnchanged\(PHASE34_LIVE_CANARY_ROOT\)/);
});

test('omitted --canary-root fails closed (no historical canary-v1 fallback)', () => {
  assert.throws(
    () => parseLiveGauntletArgs(['--out', '/tmp/phase34-live-inference-gauntlet-v2']),
    /--canary-root is required/,
  );
});

test('explicit canary-v3 root with matching launch SHA → pin PASS', () => {
  const root = mkCanary({ launchHead: 'sha-v3' });
  try {
    const opts = parseLiveGauntletArgs([
      '--canary-root',
      root,
      '--out',
      '/tmp/phase34-live-inference-gauntlet-v2',
    ]);
    assert.equal(opts.canaryRoot, root);
    assertCanaryRootEligible(opts.canaryRoot);
    const pins = assertCanaryPinsMatch({ canaryRoot: root, headSha: 'sha-v3' });
    assert.equal(pins.canary_launch_head, 'sha-v3');
    assert.equal(pins.manifest_sha256, 'deadbeef');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nonexistent canary root → fail closed', () => {
  assert.throws(
    () => assertCanaryRootEligible('/tmp/phase34-live-inference-canary-missing-xyz'),
    /does not exist/,
  );
});

test('canary root without FROZEN_PASS_EVIDENCE → fail closed', () => {
  const root = mkCanary({ frozenPass: false });
  try {
    assert.throws(() => assertCanaryRootEligible(root), /FROZEN_PASS_EVIDENCE required/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('FROZEN_BLOCKED_EVIDENCE root → fail closed', () => {
  const root = mkCanary({ frozenPass: false, frozenBlocked: true });
  try {
    assert.throws(() => assertCanaryRootEligible(root), /FROZEN_BLOCKED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canary launch SHA differs from current HEAD → fail closed', () => {
  const root = mkCanary({ launchHead: 'old-sha', frozenPass: true });
  try {
    assertCanaryRootEligible(root);
    assert.throws(
      () => assertCanaryPinsMatch({ canaryRoot: root, headSha: 'new-sha' }),
      /source SHA changed since canary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canary-v2 must not authorize a later SHA', () => {
  const canaryV2 = mkCanary({ launchHead: 'f5af49b6a7d48bd27bdf53b50d2fcaa55034d0af' });
  try {
    assert.throws(
      () =>
        assertCanaryPinsMatch({
          canaryRoot: canaryV2,
          headSha: 'later-sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      /source SHA changed since canary/,
    );
  } finally {
    fs.rmSync(canaryV2, { recursive: true, force: true });
  }
});

test('canary pacing policy pin differs → fail closed', () => {
  const root = mkCanary({ launchHead: 'sha', interBatch: INTER_BATCH_INTERVAL_MS + 250 });
  try {
    assert.throws(
      () => assertCanaryPinsMatch({ canaryRoot: root, headSha: 'sha' }),
      /pacing policy pin differs/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing canary launch pin / manifest → fail closed', () => {
  const root = mkCanary({ writeLaunch: false });
  try {
    assert.throws(() => assertCanaryPinsMatch({ canaryRoot: root, headSha: 'sha' }), /launch pin missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canary-v1 path is not silently selected by parseArgs', () => {
  assert.throws(() => parseLiveGauntletArgs([]), /--canary-root is required/);
  const opts = parseLiveGauntletArgs([
    '--canary-root',
    '/tmp/phase34-live-inference-canary-v3',
    '--out',
    '/tmp/phase34-live-inference-gauntlet-v2',
  ]);
  assert.equal(opts.canaryRoot, '/tmp/phase34-live-inference-canary-v3');
  assert.notEqual(opts.canaryRoot, '/tmp/phase34-live-inference-canary-v1');
  assert.notEqual(opts.canaryRoot, '/tmp/phase34-live-inference-canary-v2');
});

test('Phase 33F target root remains forbidden for --out', () => {
  assert.throws(
    () => assertGauntletOutEligible(PHASE33F_TARGET_ROOT_FORBIDDEN),
    /target root is forbidden/,
  );
});

test('gauntlet root must be fresh before creation', () => {
  const existing = fs.mkdtempSync('/tmp/phase34-gauntlet-existing-');
  try {
    assert.throws(() => assertGauntletOutEligible(existing), /must be absent/);
  } finally {
    fs.rmSync(existing, { recursive: true, force: true });
  }
});
