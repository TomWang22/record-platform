#!/usr/bin/env node
/**
 * Regression: every local path in Kustomize `resources:` must exist in the repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseResourcePaths(kustomizationText, baseDir) {
  const resources = [];
  let inResources = false;
  for (const line of kustomizationText.split('\n')) {
    if (/^resources:\s*$/.test(line)) {
      inResources = true;
      continue;
    }
    if (inResources) {
      if (/^\s*-\s+/.test(line)) {
        let rel = line.replace(/^\s*-\s+/, '').trim();
        if (!rel || rel.startsWith('#')) {
          continue;
        }
        rel = rel.split(/\s+#/)[0].trim();
        if (/^https?:\/\//.test(rel)) {
          continue;
        }
        resources.push(path.resolve(baseDir, rel));
        continue;
      }
      if (line.trim() && !line.startsWith('#') && !line.startsWith(' ')) {
        break;
      }
      if (line.trim() === '' || line.startsWith('#')) {
        continue;
      }
      if (!line.startsWith(' ')) {
        break;
      }
    }
  }
  return resources;
}

function findKustomizationFiles(root) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === 'kustomization.yaml' || entry.name === 'kustomization.yml') {
        hits.push(full);
      }
    }
  }
  return hits;
}

describe('kustomize resources exist', () => {
  it('every resources: entry under infra/ resolves to a tracked path', () => {
    const infraRoot = path.join(REPO_ROOT, 'infra');
    const missing = [];
    for (const file of findKustomizationFiles(infraRoot)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const resourcePath of parseResourcePaths(text, path.dirname(file))) {
        if (!fs.existsSync(resourcePath)) {
          missing.push({ kustomization: path.relative(REPO_ROOT, file), resource: resourcePath });
        }
      }
    }
    assert.deepEqual(missing, [], `missing kustomize resources: ${JSON.stringify(missing, null, 2)}`);
  });
});
