import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { validatePhase33bDataLineage } from '../scripts/lib/phase33b-data-lineage.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'scripts/ai-platform');
const CLI = path.join(SRC, 'verify-phase33b-data-lineage.mjs');

let tmpRoot;
let packageRoot;

function readLineage() {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data-source-lineage.json'), 'utf8'));
}

function writeLineage(doc) {
  fs.writeFileSync(
    path.join(packageRoot, 'data-source-lineage.json'),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
}

function validate() {
  return validatePhase33bDataLineage(REPO_ROOT, { packageRoot });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33b-lineage-'));
  packageRoot = path.join(tmpRoot, 'ai-platform');
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const f of [
    'data-source-lineage.json',
    'retrieval-acceptance-policy.json',
  ]) {
    fs.copyFileSync(path.join(SRC, f), path.join(packageRoot, f));
  }
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('phase33b data lineage', () => {
  it('valid lineage package', () => {
    const report = validatePhase33bDataLineage(REPO_ROOT);
    assert.equal(report.status, 'PASS', report.violations.join('\n'));
    assert.ok(report.source_count >= 16);
  });

  it('CLI JSON stdout/stderr separation', () => {
    const result = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'PASS');
    assert.ok(result.stderr.includes('sources='));
  });

  it('duplicate source ID', () => {
    const doc = readLineage();
    doc.sources.push({ ...doc.sources[0] });
    writeLineage(doc);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('duplicate_source_id:')));
  });

  it('invalid privacy class', () => {
    const doc = readLineage();
    doc.sources[0].privacy_class = 'NOT_A_CLASS';
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('invalid_privacy_class:')));
  });

  it('private cross-user source', () => {
    const doc = readLineage();
    const src = doc.sources.find((s) => s.privacy_class === 'OWNER_PRIVATE');
    src.cross_user_allowed = true;
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('private_cross_user_source:')));
  });

  it('prohibited embedding source', () => {
    const doc = readLineage();
    const src = doc.sources.find((s) => s.privacy_class === 'PROHIBITED');
    src.embedding_allowed = true;
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('prohibited_embedding_source:')));
  });

  it('missing deletion path', () => {
    const doc = readLineage();
    doc.sources[0].deletion_source = '';
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('missing_deletion_path:')));
  });

  it('production hard-stop mutation', () => {
    const policy = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'retrieval-acceptance-policy.json'), 'utf8'),
    );
    policy.production_hard_stops.PERCENT = 5;
    fs.writeFileSync(
      path.join(packageRoot, 'retrieval-acceptance-policy.json'),
      `${JSON.stringify(policy, null, 2)}\n`,
    );
    assert.ok(validate().violations.includes('PERCENT_nonzero'));
  });

  it('unsupported training terminology', () => {
    const doc = readLineage();
    doc.sources[0].known_gaps.push('the model was trained on private mail');
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('unsupported_training_claim:')));
  });

  it('private-field fixture scan', () => {
    const doc = readLineage();
    doc.sources[0].fields_used.push('user@example.com');
    writeLineage(doc);
    assert.ok(validate().violations.some((v) => v.startsWith('private_field_fixture:')));
  });
});
