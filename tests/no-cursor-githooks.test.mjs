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

  it('rejects Generated-by Cursor trailer', () => {
    const result = runCommitMsg('feat: x\n\nGenerated-by: Cursor\n');
    assert.notEqual(result.status, 0);
  });

  it('rejects on-behalf-of Cursor trailer', () => {
    const result = runCommitMsg('feat: x\n\non-behalf-of: Cursor\n');
    assert.notEqual(result.status, 0);
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
    execFileSync('git', ['config', 'user.useConfigOnly', 'true'], { cwd: dir });
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

  it('CURSOR_AGENT=1 with clean owner Git metadata passes', () => {
    const dir = initRepo();
    try {
      execFileSync('git', ['commit', '-m', 'clean under cursor agent env'], {
        cwd: dir,
        env: {
          ...process.env,
          CURSOR_AGENT: '1',
          CURSOR_LAYOUT: '1',
        },
      });
      const log = execFileSync('git', ['log', '-1', '--format=%an <%ae> | %cn <%ce>'], {
        cwd: dir,
        encoding: 'utf8',
      });
      assert.equal(log.trim(), 'MelonGodTier <tomwang22@yahoo.com> | MelonGodTier <tomwang22@yahoo.com>');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Cursor author fails', async () => {
    const { auditCommitIdentity, auditOwnerGitIdentity } = await import(
      '../scripts/lib/no-cursor-attribution-policy.mjs'
    );
    const identity = auditCommitIdentity({
      authorName: 'Cursor',
      authorEmail: 'cursoragent@cursor.com',
      committerName: 'MelonGodTier',
      committerEmail: 'tomwang22@yahoo.com',
    });
    assert.equal(identity.status, 'FAIL');
    assert.ok(identity.violations.some((v) => v.field === 'author_name'));
    const owner = auditOwnerGitIdentity({
      authorName: 'Cursor',
      authorEmail: 'cursoragent@cursor.com',
      committerName: 'MelonGodTier',
      committerEmail: 'tomwang22@yahoo.com',
    });
    assert.equal(owner.status, 'FAIL');
  });

  it('Cursor committer fails', async () => {
    const { auditCommitIdentity, auditOwnerGitIdentity } = await import(
      '../scripts/lib/no-cursor-attribution-policy.mjs'
    );
    const identity = auditCommitIdentity({
      authorName: 'MelonGodTier',
      authorEmail: 'tomwang22@yahoo.com',
      committerName: 'Cursor Agent',
      committerEmail: 'cursoragent@cursor.com',
    });
    assert.equal(identity.status, 'FAIL');
    assert.ok(identity.violations.some((v) => v.field.startsWith('committer_')));
    const owner = auditOwnerGitIdentity({
      authorName: 'MelonGodTier',
      authorEmail: 'tomwang22@yahoo.com',
      committerName: 'Cursor Agent',
      committerEmail: 'cursoragent@cursor.com',
    });
    assert.equal(owner.status, 'FAIL');
  });

  it('mixed outgoing range fails when any commit is non-owner', async () => {
    const { auditOwnerGitIdentity, auditCommitMessage } = await import(
      '../scripts/lib/no-cursor-attribution-policy.mjs'
    );
    const outgoing = [
      {
        authorName: 'MelonGodTier',
        authorEmail: 'tomwang22@yahoo.com',
        committerName: 'MelonGodTier',
        committerEmail: 'tomwang22@yahoo.com',
        message: 'good commit',
      },
      {
        authorName: 'MelonGodTier',
        authorEmail: 'tomwang22@yahoo.com',
        committerName: 'MelonGodTier',
        committerEmail: 'tomwang22@yahoo.com',
        message: 'bad\n\nCo-authored-by: Cursor <cursoragent@cursor.com>',
      },
    ];
    const violations = [];
    for (const c of outgoing) {
      violations.push(...auditOwnerGitIdentity(c).violations);
      violations.push(...auditCommitMessage(c.message).violations);
    }
    assert.ok(violations.length >= 1);
    assert.ok(violations.some((v) => v.kind === 'trailer'));
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
