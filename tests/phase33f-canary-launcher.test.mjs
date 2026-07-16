import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
  SMOKE,
  CANARY,
  CAPABILITIES,
} from '../scripts/lib/phase33f-canary-config.mjs';
import {
  buildSmokeManifest,
  buildCanaryManifest,
  validateManifestRowsForMode,
  auditProductionMutationRows,
} from '../scripts/lib/phase33f-canary-manifest.mjs';
import {
  runPhase33fCanaryPreflight,
  assertRealGauntletRootsAbsent,
  PRELAUNCH_BLOCKED_CODE,
} from '../scripts/lib/phase33f-canary-preflight.mjs';
import { evaluateTerminalVerdict, collectTerminalSnapshot } from '../scripts/lib/phase33f-terminal-verdict.mjs';
import { groupRowsIntoTriplets, capabilityRoutePath } from '../scripts/lib/phase33f-capability-runner.mjs';
import { validateManifestRows } from '../scripts/lib/phase33f-manifest.mjs';

function baseOpts(overrides = {}) {
  return {
    out: REAL_CANARY_ROOT,
    mode: 'canary',
    skipSourceReconciliation: true,
    headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    originMainSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    skipCiApproval: true,
    skipAttribution: true,
    skipDirtySourceCheck: true,
    skipOfflineVerify: true,
    skipSemantic: true,
    skipCoverage: true,
    skipDiskPreflight: true,
    skipCollectorExclusivity: true,
    skipEdgeHealth: true,
    runAuthSmoke: () => ({ status: 'PASS' }),
    runQuicPcapPreflight: () => ({ status: 'PASS' }),
    ...overrides,
  };
}

function isFrozenGauntletRoot(root) {
  return (
    fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE')) ||
    fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE'))
  );
}

/** Frozen canary-v1 may remain; unfrozen canary or any target must stay absent. */
function assertRealCanaryAllowedState() {
  assert.equal(fs.existsSync(REAL_TARGET_ROOT), false);
  if (!fs.existsSync(REAL_CANARY_ROOT)) return { canary_absent: true, canary_frozen_ok: false };
  assert.equal(
    isFrozenGauntletRoot(REAL_CANARY_ROOT),
    true,
    'existing canary-v1 must remain frozen (immutable); do not resume or recreate',
  );
  return { canary_absent: false, canary_frozen_ok: true };
}

function assertBlocked(fn) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected throw');
  assert.equal(err.code, PRELAUNCH_BLOCKED_CODE);
  assertRealCanaryAllowedState();
  return err;
}

test('real gauntlet roots remain absent or frozen canary-v1 only', () => {
  assert.equal(fs.existsSync(REAL_TARGET_ROOT), false);
  const allowed = assertRealCanaryAllowedState();
  const proof = assertRealGauntletRootsAbsent();
  assert.equal(proof.target_absent, true);
  if (allowed.canary_absent) {
    assert.equal(proof.canary_absent, true);
  } else {
    assert.equal(proof.canary_frozen_ok, true);
    assert.equal(proof.canary_absent, false);
  }
});

test('canary and smoke manifests validate with mode-aware counts', () => {
  const canary = buildCanaryManifest();
  const smoke = buildSmokeManifest();
  assert.equal(canary.length, CANARY.probes);
  assert.equal(smoke.length, SMOKE.probes);
  assert.equal(validateManifestRowsForMode(canary, { mode: 'canary' }).status, 'PASS');
  assert.equal(validateManifestRowsForMode(smoke, { mode: 'smoke' }).status, 'PASS');
  // Default validateManifestRows still expects 720
  assert.equal(validateManifestRows(canary).status, 'PASS');
  assert.equal(validateManifestRows(smoke).status, 'FAIL');
  assert.ok(CAPABILITIES.includes('negotiation_assistance'));
  assert.ok(!CAPABILITIES.includes('negotiation'));
});

test('missing CI approval blocks before root creation', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        skipCiApproval: false,
        approvalRecord: {
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          origin_main_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          all_required_terminal_green: false,
          required_workflows: [],
          workflow_rows: [],
        },
        skipManifest: true,
      }),
    ),
  );
});

test('HEAD drift blocks before root creation', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        originMainSha: 'cccccccccccccccccccccccccccccccccccccccc',
        skipManifest: true,
      }),
    ),
  );
});

test('invalid manifest blocks before root creation', () => {
  const rows = buildCanaryManifest();
  rows.pop(); // wrong probe count
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        manifestRows: rows,
      }),
    ),
  );
});

test('production mutation row blocks preflight', () => {
  const rows = buildSmokeManifest();
  rows[0].production_mutation_allowed = true;
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        out: `/tmp/phase33f-mut-${process.pid}`,
        mode: 'smoke',
        manifestRows: rows,
      }),
    ),
  );
});

test('production mutation row fails audit', () => {
  const rows = buildSmokeManifest();
  rows[0].production_mutation_allowed = true;
  const audit = auditProductionMutationRows(rows);
  assert.equal(audit.status, 'FAIL');
  assertRealCanaryAllowedState();
});

test('foreign collector mock blocks before root creation', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        skipCollectorExclusivity: false,
        skipManifest: true,
        assertCollectorExclusivity: () => {
          const err = new Error(
            JSON.stringify({
              status: 'BLOCKED',
              code: 'PHASE32H_COLLECTOR_EXCLUSIVITY_BLOCKED',
              foreign_collectors: [{ pid: 1, evidence_root: '/tmp/foreign' }],
            }),
          );
          err.code = 'PHASE32H_COLLECTOR_EXCLUSIVITY_BLOCKED';
          throw err;
        },
      }),
    ),
  );
});

test('unreachable edge blocks before root creation', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        skipEdgeHealth: false,
        skipManifest: true,
        runEdgeHealth: () => {
          const err = new Error('edge down');
          err.code = PRELAUNCH_BLOCKED_CODE;
          throw err;
        },
      }),
    ),
  );
});

test('authorization smoke failure blocks', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        skipManifest: true,
        runAuthSmoke: () => ({ status: 'FAIL', reason: 'unauthorized' }),
      }),
    ),
  );
});

test('QUIC preflight failure blocks', () => {
  assertBlocked(() =>
    runPhase33fCanaryPreflight(
      baseOpts({
        skipManifest: true,
        runQuicPcapPreflight: () => ({ status: 'FAIL', reason: 'no_quic' }),
      }),
    ),
  );
});

test('successful mocked preflight does not create real canary root', () => {
  const tmpOut = `/tmp/phase33f-preflight-unit-${process.pid}`;
  if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });
  const result = runPhase33fCanaryPreflight(
    baseOpts({
      out: tmpOut,
      mode: 'smoke',
    }),
  );
  assert.equal(result.status, 'PASS');
  assert.equal(result.real_canary_root_created, false);
  assertRealCanaryAllowedState();
  assert.equal(fs.existsSync(tmpOut), false, 'preflight must not mkdir out');
});

test('capability routes map correctly including negotiation_assistance', () => {
  assert.equal(capabilityRoutePath('scarcity'), '/api/ai/intelligence/scarcity');
  assert.equal(capabilityRoutePath('negotiation_assistance'), '/api/ai/intelligence/negotiation');
  assert.equal(capabilityRoutePath('embeddings'), '/api/ai/intelligence/embeddings/metadata');
  assert.equal(capabilityRoutePath('semantic_search'), '/api/ai/intelligence/semantic-search');
});

test('smoke triplets group to 24 batches', () => {
  const triplets = groupRowsIntoTriplets(buildSmokeManifest());
  assert.equal(triplets.length, SMOKE.batches);
});

test('terminal verdict requires matching snapshots for PASS', () => {
  const tmp = `/tmp/phase33f-verdict-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.mkdirSync(path.join(tmp, 'shard-h1'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'shard-h2'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'shard-h3'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'batches'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'pcap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'pcap', 'continuity.json'), '{"status":"PASS","drops":0}\n');
    for (const shard of ['h1', 'h2', 'h3']) {
      fs.writeFileSync(
        path.join(tmp, `shard-${shard}`, 'phase33f-matrix.jsonl'),
        `${JSON.stringify({ ok: true, probe_id: `p-${shard}` })}\n`,
      );
    }
    fs.writeFileSync(path.join(tmp, 'batches', 'b1.json'), '{}\n');
    const snap = collectTerminalSnapshot(tmp, { expectedProbes: 3, expectedBatches: 1 });
    assert.equal(snap.status, 'PASS');
    const verdict = evaluateTerminalVerdict(tmp, {
      expectedProbes: 3,
      expectedBatches: 1,
      snapshotA: snap,
      snapshotB: snap,
    });
    assert.equal(verdict.status, 'PASS');
    const mismatch = evaluateTerminalVerdict(tmp, {
      snapshotA: snap,
      snapshotB: { ...snap, status: 'FAIL', matrix: { ...snap.matrix, fail: 1 } },
    });
    assert.equal(mismatch.status, 'FAIL');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('target root existence does not authorize launch path', () => {
  assert.equal(REAL_TARGET_ROOT.includes('target'), true);
  assert.equal(fs.existsSync(REAL_TARGET_ROOT), false);
  assertRealCanaryAllowedState();
});
