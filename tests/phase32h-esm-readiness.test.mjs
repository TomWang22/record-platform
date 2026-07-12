import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { assertNoFragileEvalUsage } from '../scripts/lib/phase32h-esm-eval-guard.mjs';
import { buildLaunchPackageReport } from '../scripts/phase32h-launch-package-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

function runNodeScript(script, args = []) {
  return spawnSync(NODE, [path.join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('phase32h esm readiness tooling', () => {
  it('valid input exits 0', () => {
    const result = runNodeScript('scripts/phase32h-launch-package-readonly.mjs');
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('valid JSON is emitted', () => {
    const result = runNodeScript('scripts/phase32h-launch-package-readonly.mjs');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'APPROVAL_PENDING');
    assert.ok(payload.manifest_sha256);
  });

  it('stderr is empty on success', () => {
    const result = runNodeScript('scripts/phase32h-launch-package-readonly.mjs');
    assert.equal(result.stderr.trim(), '');
  });

  it('malformed approval path exits nonzero', () => {
    const result = runNodeScript('scripts/phase32h-launch-package-readonly.mjs', [
      '--approval',
      '/tmp/phase32h-missing-approval.json',
    ]);
    assert.notEqual(result.status, 0);
  });

  it('no eval/TypeScript stack appears in stderr', () => {
    const result = runNodeScript('scripts/phase32h-launch-package-readonly.mjs');
    assert.ok(!/ERR_EVAL_ESM_CANNOT_PRINT|evalTypeScript|eval_string/i.test(result.stderr));
  });

  it('buildLaunchPackageReport matches CLI shape', () => {
    const report = buildLaunchPackageReport();
    assert.equal(report.launch_package_cli, 'scripts/phase32h-launch-package-readonly.mjs');
    assert.ok(report.disk);
  });

  it('parent Make target propagates launch package CLI via baseline preflight', () => {
    const result = spawnSync('make', ['ai-platform-verify-phase32h-freeze-integrity'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('pipeline does not hide launch package CLI failure', () => {
    const result = spawnSync(
      'bash',
      ['-lc', `set -o pipefail; node ${path.join(REPO_ROOT, 'scripts/phase32h-launch-package-readonly.mjs')} --approval /tmp/missing.json | tee /dev/null`],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
  });
});
