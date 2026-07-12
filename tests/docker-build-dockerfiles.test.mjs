#!/usr/bin/env node
/**
 * Regression: docker-build.yml matrix services resolve to existing Dockerfiles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/docker-build.yml');

function extractMatrixServices(workflowText) {
  const services = [];
  let inJob = false;
  let inMatrix = false;
  for (const line of workflowText.split('\n')) {
    if (/^  build-images:/.test(line)) {
      inJob = true;
      continue;
    }
    if (inJob && /^  [a-zA-Z0-9_-]+:/.test(line) && !/^  build-images:/.test(line)) {
      inJob = false;
      inMatrix = false;
      continue;
    }
    if (inJob && /^        service:/.test(line)) {
      inMatrix = true;
      continue;
    }
    if (inMatrix && /^          - /.test(line)) {
      services.push(line.replace(/^          - /, '').trim());
      continue;
    }
    if (inMatrix && /^        [a-zA-Z]/.test(line) && !/^        service:/.test(line)) {
      inMatrix = false;
    }
  }
  return services;
}

export function resolveDockerfilePath(service) {
  if (service === 'webapp') {
    return 'webapp/Dockerfile';
  }
  return `services/${service}/Dockerfile`;
}

describe('docker-build workflow Dockerfiles', () => {
  it('every matrix service resolves to an existing Dockerfile', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    const services = extractMatrixServices(text);
    assert.ok(services.length > 0, 'expected docker-build.yml build-images matrix services');

    const missing = [];
    for (const service of services) {
      const rel = resolveDockerfilePath(service);
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) {
        missing.push({ service, rel });
      }
    }

    assert.deepEqual(missing, [], `missing Dockerfiles: ${JSON.stringify(missing, null, 2)}`);
  });

  it('does not use unsupported GitHub expression string concatenation for Dockerfile path', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert.doesNotMatch(
      text,
      /file:\s*\$\{\{[^}]*\+[^}]*\}\}/,
      'docker-build.yml must not use + string concatenation inside GitHub expressions',
    );
    assert.match(
      text,
      /format\('services\/\{0\}\/Dockerfile', matrix\.service\)/,
      'docker-build.yml must use format() for service Dockerfile paths',
    );
  });
});
