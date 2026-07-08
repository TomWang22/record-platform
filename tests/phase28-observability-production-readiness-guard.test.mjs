import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhase28Docs,
  validateHarnessCodeSafety,
  validatePhase28ProductionReadinessGuard,
  Phase28ProductionReadinessGuardError,
  PHASE_28A_DOC,
  PHASE_28B_DOC,
} from '../scripts/lib/phase28-observability-production-readiness-guard.mjs';
import fs from 'node:fs';

describe('phase28 observability production-readiness guard', () => {
  it('validates Phase 28A/28B docs and harness safety', () => {
    const result = validatePhase28ProductionReadinessGuard();
    assert.equal(result.status, 'PASS');
  });

  it('fails when 28A doc missing', () => {
    if (!fs.existsSync(PHASE_28A_DOC)) {
      assert.throws(() => validatePhase28Docs(), Phase28ProductionReadinessGuardError);
      return;
    }
    const backup = fs.readFileSync(PHASE_28A_DOC, 'utf8');
    fs.writeFileSync(PHASE_28A_DOC, '');
    try {
      assert.throws(() => validatePhase28Docs(), Phase28ProductionReadinessGuardError);
    } finally {
      fs.writeFileSync(PHASE_28A_DOC, backup);
    }
  });

  it('fails on forbidden production rollout claim in docs', () => {
    if (!fs.existsSync(PHASE_28B_DOC)) return;
    const backup = fs.readFileSync(PHASE_28B_DOC, 'utf8');
    fs.writeFileSync(PHASE_28B_DOC, `${backup}\nproduction rollout approved`);
    try {
      assert.throws(() => validatePhase28Docs(), Phase28ProductionReadinessGuardError);
    } finally {
      fs.writeFileSync(PHASE_28B_DOC, backup);
    }
  });

  it('harness code safety passes on current harness', () => {
    const result = validateHarnessCodeSafety();
    assert.equal(result.status, 'PASS');
  });
});
