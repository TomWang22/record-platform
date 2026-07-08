import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeSearchabilityKpiFromChecks,
  summarizeSearchabilityKpiHonest,
} from '../scripts/lib/phase26c-searchability-kpi-readonly.mjs';

describe('phase26c searchability kpi readonly', () => {
  it('reports PASS with p50/p95/max when check rows exist', () => {
    const result = summarizeSearchabilityKpiFromChecks([
      { source_type: 'listing', arrival_to_searchable_ms: 1000, searchable_verified_at: '2026-07-08T01:00:00Z' },
      { source_type: 'listing', arrival_to_searchable_ms: 3000, searchable_verified_at: '2026-07-08T01:01:00Z' },
      { source_type: 'listing', arrival_to_searchable_ms: 2000, searchable_verified_at: '2026-07-08T01:02:00Z' },
    ]);
    assert.equal(result.status, 'PASS');
    assert.equal(result.kpi_searchability_checks_available, true);
    assert.equal(result.arrival_to_searchable_ms.sample_count, 3);
    assert.equal(result.arrival_to_searchable_ms.p50, 2000);
    assert.equal(result.arrival_to_searchable_ms.max, 3000);
  });

  it('reports GAP honestly when no check rows', () => {
    const result = summarizeSearchabilityKpiHonest([], { last_run: { started_at: 'x', finished_at: 'y' } });
    assert.equal(result.status, 'GAP');
    assert.equal(result.kpi_searchability_checks_available, false);
    assert.equal(result.arrival_to_searchable_ms, null);
  });

  it('does not invent arrival_to_searchable_ms without rows', () => {
    const result = summarizeSearchabilityKpiHonest([]);
    assert.equal(result.arrival_to_searchable_ms, null);
    assert.match(result.reason, /instrumented end-to-end/i);
  });
});
