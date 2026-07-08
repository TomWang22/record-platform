import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  FORBIDDEN_COLUMNS,
  CLOSEOUT_DOC,
  validatePhase26fDashboardReport,
  readFile,
  Phase26fDashboardReportGuardError,
} from '../scripts/lib/phase26f-dashboard-report-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26f dashboard report guard', () => {
  it('validates full Phase 26F dashboard/report batch', () => {
    const result = validatePhase26fDashboardReport(repoRoot);
    assert.equal(result.status, 'PASS');
  });

  it('closeout claims report-generation-only posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26F:.*PASS/i);
    assert.match(closeout, /Phase 26G:.*NOT STARTED/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /DB writes performed:.*NO/i);
    assert.match(closeout, /Migrations applied:.*NO/i);
    assert.match(closeout, /Report output committed:.*NO/i);
    assert.match(closeout, /Bench logs committed:.*NO/i);
  });

  it('report library guards forbidden payload keys', () => {
    const reportLib = readFile(repoRoot, 'scripts/lib/phase26f-combined-kpi-report-readonly.mjs');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.ok(reportLib.includes(forbidden), `missing forbidden guard for ${forbidden}`);
    }
  });

  it('artifact SHA unchanged', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26fDashboardReportGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26fDashboardReportGuardError('test');
      },
      (err) => err.name === 'Phase26fDashboardReportGuardError',
    );
  });
});
