import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASE27_DOCS,
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  validatePhase27OperationalEnablement,
  validatePhase27Doc,
  validateDrillScript,
  readFile,
  Phase27OperationalEnablementGuardError,
} from '../scripts/lib/phase27-operational-enablement-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase27 operational enablement guard', () => {
  it('validates Phase 27B–27H docs and drill without requiring live eval', () => {
    const result = validatePhase27OperationalEnablement(repoRoot, { runIntrospection: false });
    assert.equal(result.status, 'PASS');
    assert.equal(result.docs_checked, 7);
  });

  it('closeouts keep production posture and artifact SHA', () => {
    for (const [label, rel] of Object.entries(PHASE27_DOCS)) {
      const doc = readFile(repoRoot, rel);
      assert.doesNotThrow(() => validatePhase27Doc(doc, label));
      assert.ok(doc.includes(EXPECTED_ARTIFACT_SHA));
      assert.match(doc, /Live eval(?:\s+run)?:\*?\*?\s*NOT RUN/i);
    }
  });

  it('drill uses implemented write paths against local/dev', () => {
    assert.doesNotThrow(() => validateDrillScript(readFile(repoRoot, 'scripts/phase27-controlled-kpi-enablement-drill.py')));
  });

  it('knows the forbidden column set', () => {
    assert.ok(FORBIDDEN_COLUMNS.includes('response_body'));
    assert.ok(FORBIDDEN_COLUMNS.includes('proxy_max_bid'));
  });

  it('Phase27OperationalEnablementGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase27OperationalEnablementGuardError('test');
      },
      (err) => err.name === 'Phase27OperationalEnablementGuardError',
    );
  });
});
