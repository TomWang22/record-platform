import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  batchIdFromProbe,
  batchTimingStatus,
  computeStartSpreadMs,
} from '../scripts/lib/phase32h-triplet-batch.mjs';
import { groupManifestIntoTriplets } from '../scripts/lib/phase32h-triplet-manifest.mjs';
import { mainMatrixUsesTripletOrchestrator } from '../scripts/lib/phase32h-triplet-orchestrator.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

describe('phase32h triplet runner', () => {
  it('launch path uses triplet orchestrator not independent shard loops', () => {
    const launchScript = path.join(REPO_ROOT, 'scripts/phase32h-launch-r1-arm.mjs');
    assert.equal(mainMatrixUsesTripletOrchestrator(launchScript), true);
    const text = fs.readFileSync(launchScript, 'utf8');
    assert.ok(text.includes('phase32h-r1-triplet-runner.mjs'));
    assert.ok(!text.includes("launchShard('h1'"));
  });

  it('assigns exactly one protocol member per batch', () => {
    const manifest = [
      { probe_id: 1, matrix_protocol: 'h1', window: 2, run: 3, case_id: 'c', user_uid: 'u', user_class: 'a' },
      { probe_id: 2, matrix_protocol: 'h2', window: 2, run: 3, case_id: 'c', user_uid: 'u', user_class: 'a' },
      { probe_id: 3, matrix_protocol: 'h3', window: 2, run: 3, case_id: 'c', user_uid: 'u', user_class: 'a' },
    ];
    const batches = groupManifestIntoTriplets(manifest);
    assert.equal(batches.length, 1);
    assert.equal(batchIdFromProbe(manifest[0]), batches[0].batch_id);
  });

  it('computes batch start spread timing gates', () => {
    const spread = computeStartSpreadMs([
      '2026-07-11T20:00:00.000Z',
      '2026-07-11T20:00:00.040Z',
      '2026-07-11T20:00:00.080Z',
    ]);
    assert.equal(spread, 80);
    assert.equal(batchTimingStatus(40), 'PASS');
    assert.equal(batchTimingStatus(75), 'PASS_WITH_NOTE');
    assert.equal(batchTimingStatus(150), 'PARTIAL');
    assert.equal(batchTimingStatus(600), 'REJECTED');
  });
});
