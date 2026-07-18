/**
 * Guard: repo root must not contain harness-redirected openssl artifacts named 0/1/2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repo root has no numeric openssl redirect artifacts 0/1/2', () => {
  for (const name of ['0', '1', '2']) {
    const p = path.join(REPO, name);
    if (!fs.existsSync(p)) continue;
    const head = fs.readFileSync(p, 'utf8').slice(0, 80);
    const looksLikeOpenssl =
      head.includes('CONNECTED(') ||
      head.includes('BEGIN CERTIFICATE') ||
      head.includes('Certificate chain');
    assert.equal(
      looksLikeOpenssl,
      false,
      `${name} looks like openssl redirect output — move under /tmp audit and delete from worktree`,
    );
  }
});
