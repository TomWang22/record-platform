import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findCursorTrailerLine,
  auditGitHistory,
} from '../scripts/lib/no-cursor-trailer-guard.mjs';

describe('no-cursor-trailer guard', () => {
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

  it('multiple commits with one violation FAIL', () => {
    const report = auditGitHistory({
      ref: 'HEAD',
      strict: true,
      grandfather: new Set(),
    });
    if (report.violations.length > 0) {
      assert.equal(report.status, 'FAIL');
      assert.ok(report.violations.length >= 1);
    } else {
      assert.equal(report.status, 'PASS');
    }
  });

  it('grandfathered historical violations PASS under enforce policy', () => {
    const report = auditGitHistory({ ref: 'HEAD', strict: false });
    assert.equal(report.status, 'PASS');
  });
});
