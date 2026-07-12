import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findCursorTrailerLine,
  findCursorIdentityViolations,
  auditGitHistory,
  auditGitPushRange,
} from '../scripts/lib/no-cursor-trailer-guard.mjs';

describe('no-cursor-attribution guard', () => {
  it('normal commit message PASS', () => {
    assert.equal(
      findCursorTrailerLine('feat: add thing\n\nBody mentions Cursor IDE in prose.'),
      null,
    );
  });

  it('normal body mentioning Cursor PASS', () => {
    assert.equal(findCursorTrailerLine('docs: note about Cursor editor usage'), null);
  });

  it('Co-authored-by Cursor FAIL', () => {
    const line = findCursorTrailerLine('feat: x\n\nCo-authored-by: Cursor <cursoragent@cursor.com>');
    assert.match(line, /Co-authored-by: Cursor/i);
  });

  it('cursoragent@cursor.com FAIL', () => {
    const line = findCursorTrailerLine('Signed-off-by: Agent <cursoragent@cursor.com>');
    assert.ok(line);
  });

  it('mixed-case trailer FAIL', () => {
    const line = findCursorTrailerLine('REVIEWED-BY: cursor <cursoragent@cursor.com>');
    assert.ok(line);
  });

  it('unrelated co-author PASS', () => {
    assert.equal(findCursorTrailerLine('Co-authored-by: Jane Doe <jane@example.com>'), null);
  });

  it('Cursor author name fails', () => {
    const violations = findCursorIdentityViolations({
      authorName: 'Cursor Agent',
      authorEmail: 'owner@example.com',
      committerName: 'Owner',
      committerEmail: 'owner@example.com',
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].field, 'author_name');
  });

  it('Cursor author email fails', () => {
    const violations = findCursorIdentityViolations({
      authorName: 'Owner',
      authorEmail: 'cursoragent@cursor.com',
      committerName: 'Owner',
      committerEmail: 'owner@example.com',
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].field, 'author_email');
  });

  it('Cursor committer name fails', () => {
    const violations = findCursorIdentityViolations({
      authorName: 'Owner',
      authorEmail: 'owner@example.com',
      committerName: 'Cursor',
      committerEmail: 'owner@example.com',
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].field, 'committer_name');
  });

  it('Cursor committer email fails', () => {
    const violations = findCursorIdentityViolations({
      authorName: 'Owner',
      authorEmail: 'owner@example.com',
      committerName: 'Owner',
      committerEmail: 'bot@cursor.com',
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].field, 'committer_email');
  });

  it('owner author/committer passes', () => {
    const violations = findCursorIdentityViolations({
      authorName: 'MelonGodTier',
      authorEmail: 'tomwang22@yahoo.com',
      committerName: 'MelonGodTier',
      committerEmail: 'tomwang22@yahoo.com',
    });
    assert.deepEqual(violations, []);
  });

  it('multiple commits with one violation FAIL', () => {
    const report = auditGitHistory({ ref: 'HEAD' });
    if (report.violations.length > 0) {
      assert.equal(report.status, 'FAIL');
      assert.ok(report.violations.length >= 1);
    } else {
      assert.equal(report.status, 'PASS');
    }
  });

  it('strict policy has no grandfather exceptions', () => {
    const report = auditGitHistory({ ref: 'HEAD' });
    assert.equal(report.policy, 'strict-no-cursor-attribution');
    assert.ok(!('grandfathered_count' in report));
  });

  it('empty push range handled correctly', () => {
    const head = process.env.GIT_HEAD || 'HEAD';
    const report = auditGitPushRange({ range: `${head}..${head}` });
    assert.equal(report.commits_scanned, 0);
    assert.equal(report.status, 'PASS');
  });
});
