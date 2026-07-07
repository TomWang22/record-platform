import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  PHASE_25_DOCS,
  REQUIRED_JSON_OUTPUTS,
  REQUIRED_TABLES,
  REQUIRED_PHASE_26_PHASES,
  EVIDENCE_LABELS,
  PRIVACY_RULES,
  validatePhase25Design,
  Phase25DesignGuardError,
  readDoc,
} from '../scripts/lib/phase25-observability-design-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase25 observability design guard', () => {
  it('validates full Phase 25 design batch', () => {
    const result = validatePhase25Design(repoRoot);
    assert.equal(result.status, 'PASS');
    assert.equal(result.docs_checked, PHASE_25_DOCS.length);
  });

  it('all Phase 25 docs exist', () => {
    for (const doc of PHASE_25_DOCS) {
      const text = readDoc(repoRoot, doc);
      assert.ok(text.length > 100, `${doc} should have content`);
    }
  });

  it('schema proposal documents all required tables', () => {
    const schema = readDoc(repoRoot, 'docs/ai-platform/PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md');
    for (const table of REQUIRED_TABLES) {
      assert.ok(schema.includes(table), `25B missing ${table}`);
    }
  });

  it('extractor contract documents all JSON outputs', () => {
    const extractor = readDoc(repoRoot, 'docs/ai-platform/PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md');
    for (const output of REQUIRED_JSON_OUTPUTS) {
      assert.ok(extractor.includes(output), `25C missing ${output}`);
    }
  });

  it('rollout plan defines Phase 26A–26G', () => {
    const rollout = readDoc(repoRoot, 'docs/ai-platform/PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md');
    for (const phase of REQUIRED_PHASE_26_PHASES) {
      assert.ok(rollout.includes(phase), `rollout missing ${phase}`);
    }
  });

  it('closeout claims design-only posture', () => {
    const closeout = readDoc(repoRoot, 'docs/ai-platform/PHASE_25F_OBSERVABILITY_INSTRUMENTATION_DESIGN_CLOSEOUT.md');
    assert.match(closeout, /Phase 25:.*CLOSED PASS/i);
    assert.match(closeout, /DB schema changes applied:.*NO/i);
    assert.match(closeout, /Migrations applied:.*NO/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
  });

  it('evidence labels preserved across design docs', () => {
    const combined = PHASE_25_DOCS.map((doc) => readDoc(repoRoot, doc)).join('\n');
    for (const label of EVIDENCE_LABELS) {
      assert.ok(combined.includes(label) || combined.includes(label.replace(': ', ' ')), `missing evidence label: ${label}`);
    }
  });

  it('privacy rules documented', () => {
    const combined = PHASE_25_DOCS.map((doc) => readDoc(repoRoot, doc)).join('\n');
    for (const rule of PRIVACY_RULES) {
      assert.ok(combined.includes(rule), `missing privacy rule: ${rule}`);
    }
  });

  it('artifact SHA matches locked value in contracts', () => {
    const contract = readDoc(repoRoot, 'docs/ai-platform/PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md');
    assert.ok(contract.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase25DesignGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase25DesignGuardError('test');
      },
      (err) => err.name === 'Phase25DesignGuardError',
    );
  });
});
