import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ReplayResumeValidationError,
  buildDryRunCases,
  completedBatchIds,
  computeRemainingProbes,
  effectiveLastProbeId,
  loadCompletedRows,
  loadJsonlRows,
  makeManifest,
  makeProbeRow,
  readCheckpoint,
  runDryRunValidation,
  runExpectFailureCase,
  runValidationCase,
  validateCheckpoint,
  writeCheckpoint,
  writeJsonl,
} from '../scripts/lib/phase23c-replay-resume-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/phase23c-dry-run-replay-resume-validation.mjs');

test('phase23c dry-run script exits PASS', () => {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS: Phase 23C dry-run replay resume\/checkpoint validation/);
});

test('phase23c library cases all pass in isolated fixture root', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase23c-test-'));
  const { failed, results } = runDryRunValidation({ fixtureRoot });
  assert.equal(failed.length, 0, JSON.stringify(results, null, 2));
  assert.equal(results.length, 10);
});

test('loadCompletedRows merges main and per-batch JSONL without duplicates', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase23c-merge-'));
  const mainJsonl = path.join(fixtureRoot, 'main.jsonl');
  const batchDir = path.join(fixtureRoot, 'batches');
  fs.mkdirSync(batchDir, { recursive: true });
  writeJsonl(mainJsonl, [makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A' })]);
  writeJsonl(path.join(batchDir, 'BATCH-B.jsonl'), [makeProbeRow({ probe_id: 2, batch_id: 'BATCH-B' })]);
  const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
  assert.deepEqual(completed.map((row) => row.probe_id), [1, 2]);
});

test('duplicate probe_id detection fails fast', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase23c-dup-'));
  const mainJsonl = path.join(fixtureRoot, 'dup.jsonl');
  fs.writeFileSync(
    mainJsonl,
    `${JSON.stringify(makeProbeRow({ probe_id: 9, batch_id: 'BATCH-A' }))}\n${JSON.stringify(makeProbeRow({ probe_id: 9, batch_id: 'BATCH-A' }))}\n`,
  );
  assert.throws(() => loadJsonlRows(mainJsonl), ReplayResumeValidationError);
});

test('checkpoint validation rejects protocol and phase mismatch', () => {
  assert.throws(
    () => validateCheckpoint({ protocol: 'h3', phase: '22I', last_probe_id: 1, completed_batches: [] }, { protocol: 'h2', phase: '22I' }),
    ReplayResumeValidationError,
  );
  assert.throws(
    () => validateCheckpoint({ protocol: 'h2', phase: '22J', last_probe_id: 1, completed_batches: [] }, { protocol: 'h2', phase: '22I' }),
    ReplayResumeValidationError,
  );
});

test('jsonl wins over stale checkpoint last_probe_id', () => {
  const rows = [makeProbeRow({ probe_id: 1, batch_id: 'A' }), makeProbeRow({ probe_id: 2, batch_id: 'A' })];
  const checkpoint = { last_probe_id: 1, completed_batches: ['A'] };
  assert.equal(effectiveLastProbeId(checkpoint, rows), 2);
});

test('completed batch tracking derives from completed rows', () => {
  const rows = [
    makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A' }),
    makeProbeRow({ probe_id: 2, batch_id: 'BATCH-B' }),
    makeProbeRow({ probe_id: 3, batch_id: 'BATCH-A' }),
  ];
  assert.deepEqual(completedBatchIds(rows).sort(), ['BATCH-A', 'BATCH-B']);
});

test('partial batch continuation leaves only incomplete probes', () => {
  const manifest = makeManifest([
    { probe_id: 1, batch_id: 'BATCH-A' },
    { probe_id: 2, batch_id: 'BATCH-A' },
    { probe_id: 3, batch_id: 'BATCH-A' },
  ]);
  const completed = [makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A' })];
  const remaining = computeRemainingProbes(manifest, completed);
  assert.deepEqual(remaining.map((row) => row.probe_id), [2, 3]);
});

test('buildDryRunCases includes expected failure scenarios', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase23c-cases-'));
  const cases = buildDryRunCases(fixtureRoot);
  const names = cases.map((testCase) => testCase.name);
  assert.ok(names.includes('duplicate probe_id in JSONL fails'));
  assert.ok(names.includes('wrong protocol in checkpoint fails'));
  assert.ok(names.includes('corrupt JSONL line fails'));
});

test('runExpectFailureCase marks expected failures as PASS', () => {
  const pass = runExpectFailureCase('expected fail', () => {
    throw new ReplayResumeValidationError('boom');
  });
  assert.equal(pass.status, 'PASS');
  const fail = runExpectFailureCase('unexpected pass', () => {});
  assert.equal(fail.status, 'FAIL');
});

test('runValidationCase marks success as PASS', () => {
  const pass = runValidationCase('ok', () => {});
  assert.equal(pass.status, 'PASS');
});

test('readCheckpoint returns null for missing file', () => {
  assert.equal(readCheckpoint(path.join(repoRoot, 'does-not-exist.json')), null);
});
