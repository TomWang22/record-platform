import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { findExactCursorCoauthorTrailerLine } from '../scripts/lib/no-cursor-attribution-policy.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const COMMIT_MSG = path.join(REPO_ROOT, 'scripts/githooks/commit-msg.mjs');

function runCommitMsg(message) {
  const file = path.join(os.tmpdir(), `commit-msg-${Date.now()}.txt`);
  fs.writeFileSync(file, message, 'utf8');
  const result = spawnSync(process.execPath, [COMMIT_MSG, file], { encoding: 'utf8' });
  fs.rmSync(file, { force: true });
  return result;
}

describe('commit-msg hook', () => {
  it('rejects exact Cursor co-author trailer', () => {
    const result = runCommitMsg('feat: x\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden attribution trailer/i);
  });

  it('allows ordinary Cursor prose', () => {
    const result = runCommitMsg('docs: note about Cursor editor integration\n');
    assert.equal(result.status, 0);
  });

  it('allows unrelated co-author', () => {
    const result = runCommitMsg('feat: x\n\nCo-authored-by: Jane Doe <jane@example.com>\n');
    assert.equal(result.status, 0);
  });
});

describe('end-to-end disposable repository fixtures', () => {
  function initRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-metadata-fixture-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'MelonGodTier'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'tomwang22@yahoo.com'], { cwd: dir });
    execFileSync('git', ['config', 'core.hooksPath', path.join(REPO_ROOT, '.githooks')], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: dir });
    return dir;
  }

  it('direct clean commit passes', () => {
    const dir = initRepo();
    try {
      execFileSync('git', ['commit', '-m', 'clean commit'], { cwd: dir });
      const log = execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: dir, encoding: 'utf8' });
      assert.equal(log.trim(), 'MelonGodTier <tomwang22@yahoo.com>');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('commit-msg hook rejects Cursor trailer', () => {
    const dir = initRepo();
    try {
      assert.throws(
        () => execFileSync('git', ['commit', '-m', 'bad\n\nCo-authored-by: Cursor <cursoragent@cursor.com>'], { cwd: dir }),
        /failed|rejected|forbidden/i,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ordinary prose mentioning Cursor passes', () => {
    const dir = initRepo();
    try {
      execFileSync('git', ['commit', '-m', 'docs: Cursor integration notes'], { cwd: dir });
      assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim(), 'docs: Cursor integration notes');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('policy exact trailer matcher', () => {
  it('matches users.noreply variant', () => {
    const line = findExactCursorCoauthorTrailerLine(
      'Co-authored-by: Cursor Agent <cursoragent@users.noreply.github.com>',
    );
    assert.ok(line);
  });
});
