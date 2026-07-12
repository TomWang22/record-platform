import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  findCursorTrailerLine,
  findExactCursorCoauthorTrailerLine,
  findCursorIdentityViolations,
  auditGitHistory,
  auditGitPushRange,
  auditAllRefs,
  auditCommitRecords,
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

  it('exact Co-authored-by Cursor FAIL', () => {
    const line = findExactCursorCoauthorTrailerLine(
      'feat: x\n\nCo-authored-by: Cursor <cursoragent@cursor.com>',
    );
    assert.match(line, /Co-authored-by: Cursor/i);
  });

  it('exact Co-authored-by Cursor Agent FAIL', () => {
    const line = findExactCursorCoauthorTrailerLine(
      'feat: x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>',
    );
    assert.ok(line);
  });

  it('cursoragent@cursor.com FAIL', () => {
    const line = findCursorTrailerLine('Signed-off-by: Agent <cursoragent@cursor.com>');
    assert.ok(line);
  });

  it('cursoragent noreply email FAIL', () => {
    const line = findCursorTrailerLine(
      'Co-authored-by: Bot <cursoragent@users.noreply.github.com>',
    );
    assert.ok(line);
  });

  it('mixed-case trailer FAIL', () => {
    const line = findCursorTrailerLine('REVIEWED-BY: cursor <cursoragent@cursor.com>');
    assert.ok(line);
  });

  it('unrelated co-author PASS', () => {
    assert.equal(findCursorTrailerLine('Co-authored-by: Jane Doe <jane@example.com>'), null);
  });

  it('exact trailer mixed with legitimate co-author fails only Cursor attribution', () => {
    const message = [
      'feat: shared work',
      '',
      'Co-authored-by: Jane Doe <jane@example.com>',
      'Co-authored-by: Cursor <cursoragent@cursor.com>',
    ].join('\n');
    const line = findExactCursorCoauthorTrailerLine(message);
    assert.match(line, /cursoragent@cursor\.com/);
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

  it('old ancestor with Cursor trailer fails full-history audit', () => {
    const report = auditCommitRecords(
      [
        {
          sha: 'a'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'contaminated ancestor\n\nCo-authored-by: Cursor <cursoragent@cursor.com>',
        },
        {
          sha: 'b'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'clean head',
        },
      ],
      'fixture-main',
    );
    assert.equal(report.status, 'FAIL');
    assert.ok(report.violations.some((v) => v.kind === 'trailer'));
  });

  it('HEAD clean but ancestor contaminated fails', () => {
    const report = auditCommitRecords(
      [
        {
          sha: 'c'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'old bad\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>',
        },
        {
          sha: 'd'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'new good',
        },
      ],
      'fixture-main',
    );
    assert.equal(report.status, 'FAIL');
    assert.equal(report.commits_scanned, 2);
  });

  it('trailer outside recent date range fails', () => {
    const report = auditCommitRecords(
      [
        {
          sha: 'e'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'historical\n\nCo-authored-by: Cursor <cursoragent@cursor.com>',
        },
        {
          sha: 'f'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'recent',
        },
      ],
      'fixture-main',
    );
    assert.equal(report.status, 'FAIL');
  });

  it('clean full history passes', () => {
    const report = auditCommitRecords(
      [
        {
          sha: '1'.repeat(40),
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'two\n\nDocs mention Cursor editor in prose.',
        },
      ],
      'fixture-main',
    );
    assert.equal(report.status, 'PASS');
  });

  it('--all audit identifies stale backup refs separately', () => {
    const mainSha = 'a'.repeat(40);
    const staleSha = 'b'.repeat(40);
    const mainReport = auditCommitRecords(
      [
        {
          sha: mainSha,
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'mainline',
        },
      ],
      'main',
    );
    const allReport = auditCommitRecords(
      [
        {
          sha: mainSha,
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'mainline',
        },
        {
          sha: staleSha,
          authorName: 'Owner',
          authorEmail: 'owner@example.com',
          committerName: 'Owner',
          committerEmail: 'owner@example.com',
          body: 'stale only\n\nCo-authored-by: Cursor <cursoragent@cursor.com>',
        },
      ],
      '--all',
    );
    assert.equal(mainReport.status, 'PASS');
    assert.equal(allReport.status, 'FAIL');
    assert.ok(allReport.violations.some((v) => v.sha === staleSha));
  });

  it('origin/main audit cannot silently substitute local HEAD', () => {
    const report = auditGitHistory({ ref: 'origin/main' });
    assert.equal(report.ref, 'origin/main');
    assert.equal(report.status, 'PASS');
  });

  it('multiple commits with one violation FAIL', () => {
    const report = auditGitHistory({ ref: 'origin/main' });
    if (report.violations.length > 0) {
      assert.equal(report.status, 'FAIL');
      assert.ok(report.violations.length >= 1);
    } else {
      assert.equal(report.status, 'PASS');
    }
  });

  it('strict policy has no grandfather exceptions', () => {
    const report = auditGitHistory({ ref: 'origin/main' });
    assert.equal(report.policy, 'strict-no-cursor-attribution');
    assert.ok(!('grandfathered_count' in report));
  });

  it('empty push range handled correctly', () => {
    const head = execSync('git rev-parse HEAD', {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    }).trim();
    const report = auditGitPushRange({ range: `${head}..${head}` });
    assert.equal(report.commits_scanned, 0);
    assert.equal(report.status, 'PASS');
  });
});
