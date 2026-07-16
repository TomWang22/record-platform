/**
 * Phase 33F blocked-run automatic freeze regression tests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { finalizeSmokeWithFreeze } from '../scripts/lib/phase32h-smoke-collector-cleanup.mjs';
import { finalizePhase33fRun } from '../scripts/lib/phase33f-run-finalize.mjs';
import { CORRELATION_QUEUE_SCHEMA_VERSION } from '../scripts/lib/phase32h-correlation-queue.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROZEN_PASS = 'FROZEN_PASS_EVIDENCE';
const FROZEN_BLOCKED = 'FROZEN_BLOCKED_EVIDENCE';

function writeTerminalQueue(root) {
  fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'run-state', 'correlation-queue.json'),
    `${JSON.stringify({
      schema_version: CORRELATION_QUEUE_SCHEMA_VERSION,
      run_id: 'test-run',
      launch_head: 'test-head',
      manifest_sha: 'abc',
      jobs: [],
      stats: {
        pending_count: 0,
        running_count: 0,
        complete_count: 1,
        failed_count: 0,
        unresolved_count: 0,
      },
    })}\n`,
  );
  fs.writeFileSync(path.join(root, 'run-state', 'run-id'), 'test-run\n');
  fs.mkdirSync(path.join(root, 'shard-h1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shard-h1', 'phase33f-matrix.jsonl'), '');
}

describe('phase33f blocked-run freeze hardening', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33f-freeze-'));
    writeTerminalQueue(root);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('unexpected failure path writes FROZEN_BLOCKED_EVIDENCE last via finalizePhase33fRun', () => {
    const result = finalizePhase33fRun({
      outRoot: root,
      repoRoot: REPO_ROOT,
      status: 'BLOCKED',
      failureClass: 'UNEXPECTED_HTTP_422',
      failureDetails: { probe_id: 'x' },
      mode: 'smoke',
      launchHead: 'deadbeef',
      manifestSha: 'abc',
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.freeze.freezeReady, true);
    assert.ok(fs.existsSync(path.join(root, FROZEN_BLOCKED)));
    assert.ok(!fs.existsSync(path.join(root, FROZEN_PASS)));
    assert.ok(fs.existsSync(path.join(root, 'phase33f-hash-manifest.json')));
    assert.equal(result.freeze.freeze?.marker_written_last, true);
    assert.ok(fs.existsSync(path.join(root, 'reports', 'blocked-verdict.json')));
  });

  it('PASS path writes FROZEN_PASS_EVIDENCE and never FROZEN_BLOCKED', () => {
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: true,
      hashManifestName: 'phase33f-hash-manifest.json',
      markerName: FROZEN_PASS,
      markerContent: 'pass\n',
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.freezeReady, true);
    assert.equal(result.marker_name, FROZEN_PASS);
    assert.ok(fs.existsSync(path.join(root, FROZEN_PASS)));
    assert.ok(!fs.existsSync(path.join(root, FROZEN_BLOCKED)));
  });

  it('failed run cannot use FROZEN_PASS marker name from pass=false', () => {
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: false,
      hashManifestName: 'phase33f-hash-manifest.json',
      markerName: FROZEN_PASS, // caller mistake — ignored
      markerContent: 'blocked\n',
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.marker_name, FROZEN_BLOCKED);
    assert.ok(fs.existsSync(path.join(root, FROZEN_BLOCKED)));
    assert.ok(!fs.existsSync(path.join(root, FROZEN_PASS)));
  });

  it('preserves immutable block marker and refuses resume semantics', () => {
    fs.writeFileSync(path.join(root, FROZEN_BLOCKED), 'blocked\n');
    const before = fs.readFileSync(path.join(root, FROZEN_BLOCKED), 'utf8');
    assert.throws(
      () =>
        finalizeSmokeWithFreeze(root, {
          repoRoot: REPO_ROOT,
          pass: false,
          hashManifestName: 'phase33f-hash-manifest.json',
          quietPeriodMs: 50,
          gracefulMs: 300,
        }),
      /already frozen/,
    );
    assert.equal(fs.readFileSync(path.join(root, FROZEN_BLOCKED), 'utf8'), before);
  });

  it('queue non-terminal blocks freeze hashing', () => {
    fs.writeFileSync(
      path.join(root, 'run-state', 'correlation-queue.json'),
      `${JSON.stringify({
        schema_version: CORRELATION_QUEUE_SCHEMA_VERSION,
        run_id: 'test-run',
        launch_head: 'test-head',
        manifest_sha: 'abc',
        jobs: [
          {
            job_id: 'j1',
            status: 'PENDING',
            batch_id: 'b1',
            enqueued_at: new Date().toISOString(),
            run_id: 'test-run',
            launch_head: 'test-head',
            manifest_sha: 'abc',
          },
        ],
        stats: {
          pending_count: 1,
          running_count: 0,
          complete_count: 0,
          failed_count: 0,
          unresolved_count: 1,
        },
      })}\n`,
    );
    const result = finalizeSmokeWithFreeze(root, {
      repoRoot: REPO_ROOT,
      pass: false,
      hashManifestName: 'phase33f-hash-manifest.json',
      quietPeriodMs: 50,
      gracefulMs: 300,
    });
    assert.equal(result.freezeReady, false);
    assert.equal(result.queue_terminal, false);
    assert.ok(!fs.existsSync(path.join(root, FROZEN_BLOCKED)));
  });
});
