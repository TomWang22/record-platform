import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireEvidenceRootLock,
  canonicalEvidenceRoot,
  countNodeWritersForRoot,
  precreateEvidenceLayout,
  writeAtomicJson,
} from '../scripts/lib/phase34-evidence-root-lock.mjs';

function tmpRoot(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-lock-'));
  return path.join(base, name);
}

test('second writer cannot start on same root', () => {
  const root = tmpRoot('run-a');
  const a = acquireEvidenceRootLock({ evidenceRoot: root, sourceSha: 'aaa' });
  assert.equal(fs.existsSync(path.join(a.root, 'locks', 'writer-lock.json')), true);
  assert.throws(
    () => acquireEvidenceRootLock({ evidenceRoot: root, sourceSha: 'bbb' }),
    (err) => err && err.code === 'EVIDENCE_ROOT_ALREADY_OWNED',
  );
  a.release();
});

test('stale lock is not auto-deleted and refuses reuse', () => {
  const root = tmpRoot('stale');
  const a = acquireEvidenceRootLock({ evidenceRoot: root, sourceSha: 'aaa' });
  a.release({ unlinkLock: false });
  assert.equal(fs.existsSync(path.join(a.root, 'locks', 'writer-lock.json')), true);
  assert.throws(
    () => acquireEvidenceRootLock({ evidenceRoot: a.root, sourceSha: 'aaa' }),
    (err) => err && err.code === 'EVIDENCE_ROOT_ALREADY_OWNED',
  );
});

test('monitor bash process is not counted as a writer', () => {
  const root = '/tmp/phase34-real-model-full-eval-v9';
  const ps = `
  100 bash -c PID=$(cat /tmp/phase34-real-model-full-eval-v9/pid); phase34-runtime-real-model-full-eval
  200 node /Users/tom/record-platform/scripts/ai-platform/phase34-runtime-real-model-full-eval.mjs
`;
  // Ensure parent exists for canonicalization in count helper when root missing —
  // countNodeWritersForRoot calls canonicalEvidenceRoot which needs parent.
  // Use injectable path that exists under os.tmpdir instead:
  const real = tmpRoot('count');
  fs.mkdirSync(real, { recursive: true });
  const ps2 = `
  100 bash -c phase34-runtime-real-model-full-eval.mjs ${real}
  200 node /repo/scripts/ai-platform/phase34-runtime-real-model-full-eval.mjs
`;
  const n = countNodeWritersForRoot(real, { psOutput: ps2.replace('/repo', real) });
  // Only the node line should count when path matches; craft exact match:
  const ps3 = `
  100 bash -c 'phase34-runtime-real-model-full-eval.mjs watching ${real}'
  200 node /x/scripts/ai-platform/phase34-runtime-real-model-full-eval.mjs
  300 node /x/scripts/ai-platform/phase34-runtime-real-model-full-eval.mjs ${real}
`;
  assert.equal(countNodeWritersForRoot(real, { psOutput: ps3 }), 1);
  void ps;
  void n;
});

test('/tmp and /private/tmp aliases resolve to the same canonical root on macOS-like layouts', () => {
  const leaf = `phase34-alias-${Date.now()}`;
  const underTmp = path.join('/tmp', leaf);
  // create via /tmp
  fs.mkdirSync(underTmp, { recursive: true });
  try {
    const a = canonicalEvidenceRoot(underTmp);
    const b = canonicalEvidenceRoot(path.join('/private/tmp', leaf));
    // On Darwin, /tmp is typically a symlink to /private/tmp
    assert.equal(a, b);
  } finally {
    fs.rmSync(underTmp, { recursive: true, force: true });
  }
});

test('symlinked roots cannot bypass ownership', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-symlink-'));
  const real = path.join(base, 'real-root');
  const link = path.join(base, 'link-root');
  const first = acquireEvidenceRootLock({ evidenceRoot: real, sourceSha: 's1' });
  fs.symlinkSync(first.root, link);
  assert.throws(
    () => acquireEvidenceRootLock({ evidenceRoot: link, sourceSha: 's2' }),
    (err) => err && err.code === 'EVIDENCE_ROOT_ALREADY_OWNED',
  );
  first.release();
});

test('precreate ledgers makes missing failures.jsonl mean zero rows not shell error', () => {
  const root = tmpRoot('layout');
  fs.mkdirSync(root, { recursive: true });
  precreateEvidenceLayout(root);
  const failures = path.join(root, 'ledgers', 'failures.jsonl');
  assert.equal(fs.existsSync(failures), true);
  assert.equal(fs.readFileSync(failures, 'utf8'), '');
  assert.equal(fs.readFileSync(failures, 'utf8').split('\n').filter(Boolean).length, 0);
});

test('atomic checkpoint write replaces via rename', () => {
  const root = tmpRoot('ckpt');
  fs.mkdirSync(root, { recursive: true });
  const ck = path.join(root, 'run-state', 'checkpoint.json');
  writeAtomicJson(ck, { state: 'INITIALIZED_NO_ROWS', sessions_completed: 0 });
  assert.equal(JSON.parse(fs.readFileSync(ck, 'utf8')).state, 'INITIALIZED_NO_ROWS');
  writeAtomicJson(ck, { state: 'RUNNING', sessions_completed: 3 });
  assert.equal(JSON.parse(fs.readFileSync(ck, 'utf8')).sessions_completed, 3);
  assert.equal(fs.existsSync(`${ck}.tmp`), false);
});

test('frozen root refuses lock acquisition', () => {
  const root = tmpRoot('frozen');
  fs.mkdirSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE'), { recursive: true });
  assert.throws(
    () => acquireEvidenceRootLock({ evidenceRoot: root, sourceSha: 'x' }),
    (err) => err && err.code === 'EVIDENCE_ROOT_FROZEN',
  );
});

test('PID in lock payload does not alone authorize a second process', () => {
  const root = tmpRoot('pid-reuse');
  const a = acquireEvidenceRootLock({ evidenceRoot: root, sourceSha: 's' });
  // Even if we forge a lock with current pid, wx open still fails on existing file.
  assert.throws(
    () => acquireEvidenceRootLock({ evidenceRoot: a.root, sourceSha: 's' }),
    (err) => err && err.code === 'EVIDENCE_ROOT_ALREADY_OWNED',
  );
  a.release();
});
