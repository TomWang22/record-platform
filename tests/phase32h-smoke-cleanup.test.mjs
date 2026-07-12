import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, afterEach } from 'node:test';
import { stopSmokeCollectors } from '../scripts/lib/phase32h-smoke-collector-cleanup.mjs';
import { FROZEN_BLOCKED_MARKER } from '../scripts/lib/phase32h-run-integrity.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-smoke-clean-'));
}

describe('phase32h smoke collector cleanup', () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it('stopSmokeCollectors returns zero_root_scoped for empty root', () => {
    const root = tempRoot();
    roots.push(root);
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
    const result = stopSmokeCollectors(root, { repoRoot: path.resolve('scripts/..') });
    assert.equal(result.zero_root_scoped, true);
    assert.equal(result.remaining_processes.length, 0);
  });

  it('frozen roots are never modified by cleanup helper', () => {
    const root = tempRoot();
    roots.push(root);
    fs.writeFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'frozen\n');
    const before = fs.readFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'utf8');
    stopSmokeCollectors(root, { repoRoot: path.resolve('scripts/..') });
    const after = fs.readFileSync(path.join(root, FROZEN_BLOCKED_MARKER), 'utf8');
    assert.equal(before, after);
  });
});
