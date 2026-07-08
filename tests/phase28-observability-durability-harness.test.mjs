import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHappyPathFixture,
  runDurabilityPipeline,
  runDisableSwitchDrill,
  runEnabledChannelDrill,
  assertNoDuplicateIds,
  validateSearchabilityTimestampChain,
  validateQueryObservation,
  validateProtocolCoverage,
  validateUnknownProtocolDoesNotCountAsH123,
  assertForbiddenFieldsAbsent,
  validateEvidenceLabelText,
  assertOutputOutsideTmpFails,
  kpiWritesAllowed,
  DEFAULT_FLAGS_OFF,
  DEFAULT_FLAGS_ON,
  Phase28DurabilityHarnessError,
} from '../scripts/lib/phase28-observability-durability-harness.mjs';
import { buildCombinedAiPlatformKpiReport } from '../scripts/lib/phase26f-combined-kpi-report-readonly.mjs';
import { validatePhase28ProductionReadinessGuard } from '../scripts/lib/phase28-observability-production-readiness-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpOut() {
  return path.join(os.tmpdir(), `phase28-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('phase28 observability durability harness', () => {
  it('1. happy path: ingestion/searchability/query/usefulness/report all PASS', () => {
    const outDir = tmpOut();
    const result = runDurabilityPipeline(buildHappyPathFixture(), { outDir });
    assert.equal(result.child_kpi_statuses.ingestion, 'PASS');
    assert.equal(result.child_kpi_statuses.searchability, 'PASS');
    assert.equal(result.child_kpi_statuses.query_latency, 'PASS');
    assert.equal(result.child_kpi_statuses.usefulness, 'PASS');
    assert.equal(result.redaction_status, 'PASS');
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('2. missing ingestion rows: report returns GAP/PARTIAL honestly', () => {
    const fixture = buildHappyPathFixture();
    fixture.ingestionEvents = [];
    const report = buildCombinedAiPlatformKpiReport({ gitSha: 't', kpiRows: fixture });
    assert.equal(report.child_kpi_statuses.ingestion, 'GAP');
  });

  it('3. missing searchability rows: report returns GAP honestly', () => {
    const fixture = buildHappyPathFixture();
    fixture.searchabilityChecks = [];
    const report = buildCombinedAiPlatformKpiReport({ gitSha: 't', kpiRows: fixture });
    assert.equal(report.child_kpi_statuses.searchability, 'GAP');
  });

  it('4. missing query rows for one protocol: query coverage PARTIAL not PASS', () => {
    const fixture = buildHappyPathFixture();
    fixture.queryObservations = fixture.queryObservations.filter((r) => r.protocol !== 'HTTP/3');
    const report = buildCombinedAiPlatformKpiReport({ gitSha: 't', kpiRows: fixture });
    assert.equal(report.child_kpi_statuses.query_latency, 'PARTIAL');
    assert.equal(validateProtocolCoverage(fixture.queryObservations), 'PARTIAL');
  });

  it('5. missing usefulness rows for H3: usefulness coverage PARTIAL not PASS', () => {
    const fixture = buildHappyPathFixture();
    fixture.usefulnessObservations = fixture.usefulnessObservations.filter(
      (r) => r.evidence_label !== 'H3 replay 57105/57105',
    );
    const report = buildCombinedAiPlatformKpiReport({ gitSha: 't', kpiRows: fixture });
    assert.equal(report.child_kpi_statuses.usefulness, 'PARTIAL');
  });

  it('6. duplicate KPI event IDs: harness fails', () => {
    const fixture = buildHappyPathFixture();
    fixture.queryObservations[1].id = fixture.queryObservations[0].id;
    assert.throws(() => assertNoDuplicateIds(fixture), Phase28DurabilityHarnessError);
  });

  it('7. corrupt timestamp chain: arrival_to_searchable_ms validation fails', () => {
    assert.throws(
      () =>
        validateSearchabilityTimestampChain({
          data_arrived_at: '2026-07-08T10:01:00.000Z',
          searchable_verified_at: '2026-07-08T10:00:00.000Z',
          arrival_to_searchable_ms: 42,
        }),
      Phase28DurabilityHarnessError,
    );
    assert.throws(
      () => validateSearchabilityTimestampChain({ arrival_to_searchable_ms: -1 }),
      Phase28DurabilityHarnessError,
    );
  });

  it('8. negative latency: query observation validation fails', () => {
    assert.throws(
      () => validateQueryObservation({ rag_total_ms: -5 }),
      Phase28DurabilityHarnessError,
    );
  });

  it('9. unknown protocol: allowed only as unknown, cannot count toward H1/H2/H3 PASS', () => {
    const rows = [{ protocol: 'unknown', rag_total_ms: 10 }];
    assert.equal(validateProtocolCoverage(rows), 'GAP');
    validateUnknownProtocolDoesNotCountAsH123(rows);
  });

  it('10. forbidden private fields fail validation', () => {
    assert.throws(
      () => assertForbiddenFieldsAbsent({ response_body: 'secret' }),
      Phase28DurabilityHarnessError,
    );
    assert.throws(
      () => assertForbiddenFieldsAbsent({ jwt: 'x' }),
      Phase28DurabilityHarnessError,
    );
    assert.throws(
      () => assertForbiddenFieldsAbsent({ proxy_max_bid: 100 }),
      Phase28DurabilityHarnessError,
    );
  });

  it('11. evidence label drift: 7200 full parity and unlabeled 171315 fail', () => {
    assert.throws(
      () => validateEvidenceLabelText('Phase 22C 7200/7200 full parity achieved'),
      Phase28DurabilityHarnessError,
    );
    assert.throws(
      () => validateEvidenceLabelText('171315/171315 cumulative total'),
      Phase28DurabilityHarnessError,
    );
    validateEvidenceLabelText('171315/171315 labeled H1+H2+H3 only');
  });

  it('12. disable switch ON: all write attempts blocked', () => {
    const result = runDisableSwitchDrill(DEFAULT_FLAGS_OFF);
    assert.equal(result.status, 'PASS');
    assert.equal(result.blocked_channels, 4);
  });

  it('13. global observability OFF: all write attempts blocked', () => {
    const flags = { ...DEFAULT_FLAGS_ON, observability_enabled: false };
    for (const ch of ['ingestion', 'searchability', 'query', 'usefulness']) {
      assert.equal(kpiWritesAllowed(ch, flags), false);
    }
  });

  it('14. channel flag OFF: that channel blocked while others can be tested', () => {
    const flags = { ...DEFAULT_FLAGS_ON, query_observations_enabled: false };
    assert.equal(kpiWritesAllowed('query', flags), false);
    assert.equal(kpiWritesAllowed('ingestion', flags), true);
    const results = runEnabledChannelDrill(flags);
    assert.equal(results.query.written, false);
    assert.equal(results.ingestion.written, true);
  });

  it('15. report output path outside /tmp: fail', () => {
    assertOutputOutsideTmpFails(path.join(repoRoot, 'webapp'));
  });

  it('16. generated report committed in repo: guard scan passes when none staged', () => {
    assert.doesNotThrow(() => validatePhase28ProductionReadinessGuard());
  });
});
