import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  DISK_HARD_MIN_BYTES,
  DISK_PREFERRED_MIN_BYTES,
  DISK_WORST_CASE_COMBINED_BYTES,
  evaluateDiskPreflight,
} from '../scripts/lib/phase32h-disk-preflight.mjs';
import { evaluateBaselinePreflight } from '../scripts/phase32h-baseline-preflight-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

function runNodeScript(script, args = []) {
  return spawnSync(NODE, [path.join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

describe('phase32h baseline preflight hardening', () => {
  it('disk gate requires 47 GB hard minimum and 50 GB preferred', () => {
    assert.equal(DISK_HARD_MIN_BYTES, 47 * 1024 ** 3);
    assert.equal(DISK_PREFERRED_MIN_BYTES, 50 * 1024 ** 3);
    assert.equal(DISK_WORST_CASE_COMBINED_BYTES, 37 * 1024 ** 3);
    const report = evaluateDiskPreflight(os.tmpdir());
    assert.ok(['PASS', 'WARN', 'BLOCKED'].includes(report.status));
    assert.equal(report.hard_minimum_bytes, DISK_HARD_MIN_BYTES);
    assert.equal(report.preferred_minimum_bytes, DISK_PREFERRED_MIN_BYTES);
    assert.equal(report.projected_footprint_bytes, DISK_WORST_CASE_COMBINED_BYTES);
  });

  it('baseline preflight readonly exits 0 and emits JSON without ESM eval errors', () => {
    const result = runNodeScript('scripts/phase32h-baseline-preflight-readonly.mjs');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(!/ERR_EVAL_ESM_CANNOT_PRINT/i.test(result.stderr));
    assert.match(result.stdout, /"esm_closeout_tooling"/);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'PASS');
    assert.equal(payload.esm_closeout_tooling.status, 'PASS');
    assert.equal(payload.esm_closeout_tooling.replacement_cli, 'scripts/phase32h-launch-package-readonly.mjs');
    assert.equal(payload.canary_v2_historical_indexing.per_probe_indexing.includes('not available'), true);
    if (payload.disk_preflight.status === 'BLOCKED') {
      assert.equal(payload.launch_ready, false);
    }
  });

  it('pcap stats readonly exits 0 with clean stderr when pcap missing (blocked payload)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-pcap-stats-'));
    try {
      const result = runNodeScript('scripts/phase32h-pcap-stats-readonly.mjs', ['--out', tmp]);
      assert.equal(result.status, 2);
      assert.ok(!/ERR_EVAL_ESM_CANNOT_PRINT/i.test(result.stderr));
      assert.equal(result.stderr.trim(), '');
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.status, 'BLOCKED');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('pcap stats readonly rejects malformed invocation with nonzero exit', () => {
    const result = runNodeScript('scripts/phase32h-pcap-stats-readonly.mjs');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /--out required/);
    assert.ok(!/ERR_EVAL_ESM_CANNOT_PRINT/i.test(result.stderr));
  });

  it('evaluateBaselinePreflight documents historical canary batch-only indexing honestly', () => {
    const report = evaluateBaselinePreflight();
    assert.equal(report.status, 'PASS');
    assert.equal(report.esm_closeout_tooling.status, 'PASS');
    assert.equal(report.canary_v2_historical_indexing.batch_correlation, '30/30 PASS');
    assert.match(report.canary_v2_historical_indexing.per_probe_indexing, /not available/);
    assert.equal(report.baseline_launch_package.disk.hard_minimum_bytes, DISK_HARD_MIN_BYTES);
    if (report.disk_preflight.status === 'BLOCKED') {
      assert.equal(report.launch_ready, false);
    }
  });
});
