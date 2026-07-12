#!/usr/bin/env node
/**
 * Regression: GitHub Actions workflow syntax via pinned actionlint.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_SCRIPT = path.join(REPO_ROOT, 'scripts/verify-workflow-syntax.sh');

function runVerify(extraEnv = {}) {
  return spawnSync('bash', [VERIFY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 120_000,
  });
}

describe('workflow syntax verification', () => {
  it('passes actionlint on every repository workflow', () => {
    const result = runVerify();
    assert.equal(
      result.status,
      0,
      `verify-workflow-syntax failed:\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /verify-workflow-syntax: PASS/);
  });

  it('rejects unsupported + concatenation inside GitHub expressions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-syntax-fixture-'));
    const workflowDir = path.join(dir, '.github', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'bad-expression.yml'),
      [
        'name: bad-expression',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    strategy:',
        '      matrix:',
        '        service: [api-gateway]',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: docker/build-push-action@v5',
        '        with:',
        '          file: ${{ matrix.service == \'webapp\' && \'webapp/Dockerfile\' || \'services/\' + matrix.service + \'/Dockerfile\' }}',
        '',
      ].join('\n'),
      'utf8',
    );

    const bin = path.join(REPO_ROOT, '.cache/actionlint/actionlint');
    assert.ok(fs.existsSync(bin), 'expected bootstrapped actionlint binary from prior test');
    const result = spawnSync(bin, [path.join(workflowDir, 'bad-expression.yml')], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /unexpected character '\+'|Unexpected symbol|syntax-check/);
  });
});
